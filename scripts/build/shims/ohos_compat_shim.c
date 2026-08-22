/*
 * ohos_compat_shim.c — LD_PRELOAD compatibility shim for HarmonyOS-sandboxed
 * aarch64/musl processes.
 *
 * HarmonyOS's application sandbox seccomp-filters several Linux syscalls that
 * OpenHarmony itself (and the upstream kernel) supports, and returns
 * unexpected errno values from a few libc calls that assume a traditional
 * /etc/passwd-backed uid or a writable P_tmpdir. This library intercepts the
 * *libc-symbol* level of those calls and falls back to a userspace
 * implementation when the real one fails in the HarmonyOS-specific way.
 *
 * IMPORTANT — SCOPE: this only works for calls that resolve through a
 * dynamically-linked libc symbol (syscall(), getpwuid_r(), tmpfile(), ...).
 * Code that issues the syscall via inline assembly (e.g. Bun's rustix
 * `linux_raw` backend for openat2/epoll_pwait2) never touches these symbols
 * and cannot be reached by LD_PRELOAD interposition — see
 * docs/ohos-preload-shim-feasibility.md for the full matrix. Nothing here
 * replaces a source-level port; it only helps *prebuilt* dynamic-musl
 * binaries survive the sandbox without a rebuild.
 *
 * Design rule for every intercepted symbol: resolve the real implementation
 * via dlsym(RTLD_NEXT, ...) first and prefer it. Only fall back when the real
 * call fails with the specific HarmonyOS-sandbox symptom (SIGSYS / ENOENT /
 * EPERM as documented per-symbol below). For getpwuid_r/tmpfile/getcwd this
 * makes the shim a safe no-op on any target where the real call already
 * works — confirmed on-device. close_range is the one exception: on-device
 * testing found that close_range() unconditionally raises SIGSYS on real
 * HarmonyOS hardware for every parameter combination tried, independent of
 * whether this (or any) library is preloaded — matching ohos-preflight's
 * own a10_close_range probe (OH-container pass, HM-device fail) from the
 * start. So the probe-then-fallback path below always lands on the
 * fallback on this class of device; see the detailed note above
 * close_range's probe for the full story (including a testing-methodology
 * lesson: verify baseline behavior with `env -u LD_PRELOAD`, never trust a
 * shell's ambient environment).
 *
 * close_range()/syscall(SYS_close_range) handling is adapted from
 * https://github.com/hqzing/close-range-shim (MIT), which established this
 * probe-then-fallback pattern for the same HarmonyOS seccomp behavior.
 *
 * Build: see ../Makefile (OHOS NDK clang, -shared -fPIC -ldl).
 * Usage: LD_PRELOAD=/path/to/libohos_compat.so <program> ...
 *
 * Runtime toggles (comma-separated symbol names):
 *   OHOS_COMPAT_SHIM_DISABLE — turn OFF a default-on interceptor
 *                              (close_range, getpwuid_r, tmpfile, getcwd,
 *                               fchmodat2, linkat, symlinkat, splice,
 *                               epoll_pipe)
 *
 * Deliberately NOT implemented: pthread_cancel (musl stub is a no-op;
 * emulating cancellation needs cooperative checkpoints in the target
 * program, which a preload shim cannot inject). See README TODO.
 */

#define _GNU_SOURCE
#include <dirent.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <limits.h>
#include <netdb.h>
#include <netinet/in.h>
#include <pthread.h>
#include <pwd.h>
#include <sched.h>
#include <setjmp.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/ioctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#if !defined(__aarch64__)
#error "ohos_compat_shim.c: only supports aarch64 (HarmonyOS/OHOS target)"
#endif

/* /tmp is read-only in the OHOS sandbox; default TMPDIR so the program's own
 * mkstemp/getenv temp calls land on a writable, auto-cleaned path. Preserves
 * any user- or wrapper-set TMPDIR. */
__attribute__((constructor))
static void ohos_shim_init_tmpdir(void)
{
	if (!getenv("TMPDIR"))
		setenv("TMPDIR", "/data/storage/el2/base/cache", 1);
}

/* ------------------------------------------------------------------ */
/*  Runtime toggle parsing                                            */
/* ------------------------------------------------------------------ */

/* Returns 1 if `name` appears in the comma-separated list env var `var`. */
static int env_list_has(const char *var, const char *name)
{
	const char *list = getenv(var);
	if (!list || !*list)
		return 0;

	size_t name_len = strlen(name);
	const char *p = list;
	while (*p) {
		const char *comma = strchr(p, ',');
		size_t seg_len = comma ? (size_t)(comma - p) : strlen(p);
		if (seg_len == name_len && strncmp(p, name, name_len) == 0)
			return 1;
		if (!comma)
			break;
		p = comma + 1;
	}
	return 0;
}

/*
 * shim_disabled() are called from every interceptor
 * entry point — including syscall(), which every non-close_range syscall in
 * the process also routes through. A naive getenv()+scan on every single
 * call would tax the hottest path in the library for no reason: the toggle
 * env vars can't change under a running process, so parse them into a
 * bitmask exactly once (idempotent even if two threads race into this
 * before the mask is set — same env, same result, no lock needed) and turn
 * every subsequent check into a cheap strcmp + bitwise AND.
 */
enum {
	SD_CLOSE_RANGE = 1 << 0,
	SD_GETPWUID_R  = 1 << 1,
	SD_TMPFILE     = 1 << 2,
	SD_GETCWD      = 1 << 3,
	SD_FCHMODAT2   = 1 << 4,
	SD_LINKAT      = 1 << 5,
	SD_SYMLINKAT   = 1 << 6,
	SD_SPLICE      = 1 << 7,
	SD_EPOLL_PIPE  = 1 << 8,
	SD_GETADDRINFO = 1 << 9,
};

static int g_disable_mask = -1;

static void parse_toggle_masks(void)
{
	if (g_disable_mask >= 0)
		return;

	int d = 0;
	if (env_list_has("OHOS_COMPAT_SHIM_DISABLE", "close_range"))
		d |= SD_CLOSE_RANGE;
	if (env_list_has("OHOS_COMPAT_SHIM_DISABLE", "getpwuid_r"))
		d |= SD_GETPWUID_R;
	if (env_list_has("OHOS_COMPAT_SHIM_DISABLE", "tmpfile"))
		d |= SD_TMPFILE;
	if (env_list_has("OHOS_COMPAT_SHIM_DISABLE", "getcwd"))
		d |= SD_GETCWD;
	if (env_list_has("OHOS_COMPAT_SHIM_DISABLE", "fchmodat2"))
		d |= SD_FCHMODAT2;
	if (env_list_has("OHOS_COMPAT_SHIM_DISABLE", "linkat"))
		d |= SD_LINKAT;
	if (env_list_has("OHOS_COMPAT_SHIM_DISABLE", "symlinkat"))
		d |= SD_SYMLINKAT;
	if (env_list_has("OHOS_COMPAT_SHIM_DISABLE", "splice"))
		d |= SD_SPLICE;
	if (env_list_has("OHOS_COMPAT_SHIM_DISABLE", "epoll_pipe"))
		d |= SD_EPOLL_PIPE;
	if (env_list_has("OHOS_COMPAT_SHIM_DISABLE", "getaddrinfo"))
		d |= SD_GETADDRINFO;
	g_disable_mask = d; /* set last: non-negative value doubles as "done" */
}

static int shim_disabled(const char *name)
{
	parse_toggle_masks();
	if (strcmp(name, "close_range") == 0)
		return !!(g_disable_mask & SD_CLOSE_RANGE);
	if (strcmp(name, "getpwuid_r") == 0)
		return !!(g_disable_mask & SD_GETPWUID_R);
	if (strcmp(name, "tmpfile") == 0)
		return !!(g_disable_mask & SD_TMPFILE);
	if (strcmp(name, "getcwd") == 0)
		return !!(g_disable_mask & SD_GETCWD);
	if (strcmp(name, "fchmodat2") == 0)
		return !!(g_disable_mask & SD_FCHMODAT2);
	if (strcmp(name, "linkat") == 0)
		return !!(g_disable_mask & SD_LINKAT);
	if (strcmp(name, "symlinkat") == 0)
		return !!(g_disable_mask & SD_SYMLINKAT);
	if (strcmp(name, "splice") == 0)
		return !!(g_disable_mask & SD_SPLICE);
	if (strcmp(name, "epoll_pipe") == 0)
		return !!(g_disable_mask & SD_EPOLL_PIPE);
	if (strcmp(name, "getaddrinfo") == 0)
		return !!(g_disable_mask & SD_GETADDRINFO);
	return 0;
}

/* ------------------------------------------------------------------ */
/*  close_range flags (kernel UAPI, may be missing from older headers) */
/* ------------------------------------------------------------------ */
#ifndef CLOSE_RANGE_UNSHARE
# define CLOSE_RANGE_UNSHARE  (1U << 1)
#endif
#ifndef CLOSE_RANGE_CLOEXEC
# define CLOSE_RANGE_CLOEXEC  (1U << 2)
#endif
#ifndef __NR_close_range
# define __NR_close_range 436
#endif
#ifndef __NR_fchmodat2
# define __NR_fchmodat2 452
#endif

/* ==================================================================== */
/*  1. close_range() / syscall(SYS_close_range, ...)                    */
/*     Probe-once + SIGSYS catch + userspace fallback via /proc/self/fd */
/*     enumeration — pattern adapted from close-range-shim (MIT)        */
/*     https://github.com/hqzing/close-range-shim.                      */
/*                                                                       */
/*  IMPORTANT — confirmed on-device with a guarded standalone repro,    */
/*  not just reading docs: syscall(SYS_close_range, ...) unconditionally */
/*  raises SIGSYS on this HarmonyOS device's real kernel, for every      */
/*  parameter combination tried (a plain valid call, first>last,         */
/*  garbage flags alike) — independent of whether this shim, or ANY      */
/*  other library, is LD_PRELOAD-ed. This matches ohos-preflight's own   */
/*  a10_close_range probe (OH-container pass, HM-device fail) exactly;   */
/*  there is no more complicated "loading a third-party .so changes      */
/*  what's allowed" story here — an earlier draft of this comment        */
/*  claimed there was, based on a test run where the shell's ambient     */
/*  LD_PRELOAD had been silently left pointing at a *different*,         */
/*  narrower preload library by unrelated earlier testing, making every  */
/*  "baseline" run in that session actually shimmed by something else.   */
/*  Lesson, not a platform finding: verify with `env -u LD_PRELOAD`,     */
/*  never trust a shell's ambient state to be clean.                     */
/*                                                                        */
/*  Practical effect: on this class of device, the probe below always    */
/*  lands on CR_PROBE_FALLBACK — there is no "real syscall succeeds"     */
/*  path to take here, though the code still supports one for other      */
/*  devices/OS versions where close_range might actually work (matching  */
/*  ohos-preflight's OH-container track, where this probe passes).       */
/*  OHOS_COMPAT_SHIM_DISABLE=close_range does NOT reproduce true         */
/*  no-shim baseline behavior in the sense of "the operation still       */
/*  works" — the real call SIGSYS's every time regardless, so this       */
/*  reproduces "preloaded but unprotected, no probe", which crashes.     */
/*  See README's Known Platform Behavior section.                        */
/* ==================================================================== */

enum { CR_PROBE_UNKNOWN, CR_PROBE_WORKS, CR_PROBE_FALLBACK };
static int cr_probe_state = CR_PROBE_UNKNOWN;
/* Thread-local: multiple threads can independently be inside a guarded
 * SIGSYS-catching attempt at once (proven by test/functional.c's
 * pthread-based CLOSE_RANGE_UNSHARE test) — a shared jmp_buf across
 * threads would let one thread's siglongjmp corrupt another's stack. */
static __thread sigjmp_buf cr_sigsys_jmp;

static void cr_sigsys_handler(int sig)
{
	(void)sig;
	siglongjmp(cr_sigsys_jmp, 1);
}

typedef long (*real_syscall_fn)(long, ...);
static real_syscall_fn real_syscall = NULL;

/* Resolve and call the real (next-in-chain) syscall() with up to 6 args.
 * Always passes 6 positional args regardless of how many the real
 * syscall actually uses — harmless, matches how syscall() is normally
 * called with a variable argument count. */
static long cr_real_syscall(long n, long a0, long a1, long a2, long a3,
			    long a4, long a5)
{
	if (!real_syscall)
		real_syscall = (real_syscall_fn)dlsym(RTLD_NEXT, "syscall");
	if (!real_syscall) {
		errno = ENOSYS;
		return -1;
	}
	return real_syscall(n, a0, a1, a2, a3, a4, a5);
}

/* Attempt a real raw-syscall delegate call guarded by a fresh SIGSYS catch,
 * rather than trusting any cached "this syscall number works" state
 * blindly. Generic over syscall number — shared by every raw-syscall-level
 * interceptor in this file (currently close_range and fchmodat2; see each
 * symbol's own section for why a per-call guard, not just a one-time
 * process probe, is necessary). On-device testing found that even a
 * *different argument combination* of an already-probed-safe syscall
 * number can independently SIGSYS (e.g. CLOSE_RANGE_UNSHARE crashed an
 * unprotected call after a flags=0 probe had already reported success),
 * so this is deliberately called around every attempt that hasn't itself
 * been individually probed, not just once per process. Returns 1 with
 * *out_ret set if the syscall returned normally (0 or -1, doesn't matter
 * which); returns 0 if it was caught via SIGSYS instead (*out_ret
 * untouched). */
static int shim_guarded_syscall(long nr, long a0, long a1, long a2, long a3,
				long a4, long a5, long *out_ret)
{
	struct sigaction old_sa, sa;
	sigemptyset(&sa.sa_mask);
	sa.sa_flags = 0;
	sa.sa_handler = cr_sigsys_handler;
	sigaction(SIGSYS, &sa, &old_sa);

	int ok;
	if (sigsetjmp(cr_sigsys_jmp, 1) == 0) {
		*out_ret = cr_real_syscall(nr, a0, a1, a2, a3, a4, a5);
		ok = 1;
	} else {
		ok = 0;
	}

	sigaction(SIGSYS, &old_sa, NULL);
	return ok;
}

static void cr_probe_syscall(void)
{
	int fd = open("/dev/null", O_RDONLY);
	if (fd < 0) {
		cr_probe_state = CR_PROBE_FALLBACK;
		return;
	}

	long ret;
	if (shim_guarded_syscall(__NR_close_range, (long)fd, (long)fd, 0L, 0, 0, 0, &ret) &&
	    ret == 0 && fcntl(fd, F_GETFD) == -1 && errno == EBADF)
		cr_probe_state = CR_PROBE_WORKS;
	else
		cr_probe_state = CR_PROBE_FALLBACK;
	close(fd);
}

/* Userspace fallback: enumerate actually-open fds via /proc/self/fd instead
 * of a linear scan to RLIMIT_NOFILE (typically 1024-65536) — matters because
 * Bun's real call pattern is close_range(3, ~0U, CLOSE_RANGE_CLOEXEC) (see
 * bun/src/jsc/bindings/BunProcess.cpp) — a range that clamps to
 * RLIMIT_NOFILE-1, so a linear scan would mean tens of thousands of
 * close()/fcntl() calls on fds that were never open. Pattern matches
 * ohos-preflight's own validated solutions/a10_close_range.c. Precondition:
 * first <= last and flags is already validated — both call sites below
 * (close_range() and the syscall() override) check this before ever
 * reaching here, matching upstream Linux's close_range(2) semantics
 * (fs/file.c SYSCALL_DEFINE3) up front rather than relying on this
 * function to re-derive it. */
static int cr_do_fallback(unsigned int first, unsigned int last, unsigned int flags)
{
	struct rlimit rl;
	if (getrlimit(RLIMIT_NOFILE, &rl) == 0 && last >= rl.rlim_cur)
		last = rl.rlim_cur > 0 ? (unsigned int)rl.rlim_cur - 1 : 0;

	if (flags & CLOSE_RANGE_UNSHARE) {
		/* unshare(CLONE_FILES) itself was found to unconditionally
		 * SIGSYS on this device — independent of close_range's own
		 * gating, and reproduced even completely unshimmed. There is
		 * no real fd-table-privatizing fallback available: closing
		 * fds in the *shared* table instead would silently break the
		 * isolation CLOSE_RANGE_UNSHARE callers rely on (other
		 * threads/whatever this table is shared with would lose
		 * those fds too), which is worse than an honest failure. So
		 * catch the SIGSYS and report ENOSYS/EPERM rather than either
		 * crashing or silently doing the wrong thing. */
		struct sigaction old_sa, sa;
		sigemptyset(&sa.sa_mask);
		sa.sa_flags = 0;
		sa.sa_handler = cr_sigsys_handler;
		sigaction(SIGSYS, &sa, &old_sa);

		int ret, crashed = 0;
		if (sigsetjmp(cr_sigsys_jmp, 1) == 0) {
			ret = unshare(CLONE_FILES);
		} else {
			crashed = 1;
			ret = -1;
		}

		sigaction(SIGSYS, &old_sa, NULL);

		if (crashed) {
			errno = ENOSYS;
			return -1;
		}
		if (ret == -1 && errno != EINVAL)
			return -1;
	}

	DIR *d = opendir("/proc/self/fd");
	int dirfd_ = d ? dirfd(d) : -1;
	if (!d) {
		/* Extreme fallback if /proc isn't mounted/visible: linear scan,
		 * same as ohos-preflight's own documented fallback-of-the-
		 * fallback. Slow, but correct. */
		if (flags & CLOSE_RANGE_CLOEXEC) {
			for (unsigned int i = first; i <= last; i++)
				fcntl((int)i, F_SETFD, FD_CLOEXEC);
		} else {
			for (unsigned int i = first; i <= last; i++)
				close((int)i);
		}
		return 0;
	}

	struct dirent *e;
	while ((e = readdir(d))) {
		if (e->d_name[0] < '0' || e->d_name[0] > '9')
			continue;
		unsigned int fd = (unsigned int)atoi(e->d_name);
		if (fd < first || fd > last || (int)fd == dirfd_)
			continue;
		if (flags & CLOSE_RANGE_CLOEXEC)
			fcntl((int)fd, F_SETFD, FD_CLOEXEC);
		else
			close((int)fd);
	}
	closedir(d);
	return 0;
}

/* Validate against upstream Linux's close_range(2) semantics (fs/file.c:
 * SYSCALL_DEFINE3(close_range, ...) — `if (flags & ~(...)) return -EINVAL`,
 * `if (fd > max_fd) return -EINVAL`) BEFORE ever asking the real kernel or
 * touching the fallback. Two things forced this to be upfront validation
 * rather than "just ask the real syscall and pass its answer through":
 *
 *   1. On-device testing found this device's kernel does NOT enforce
 *      `first > last` -> EINVAL the way upstream Linux does — it silently
 *      returns success for e.g. close_range(4, 3, 0). Deferring to "real"
 *      behavior here would leak that platform quirk to every caller
 *      instead of the standards-conformant behavior a consumer coded
 *      against Linux (like Bun) actually expects.
 *   2. Forwarding genuinely invalid flags (e.g. all bits set) to the raw
 *      syscall on this device raises an *unhandled* SIGSYS and kills the
 *      process — worse than a graceful EINVAL. Rejecting bad flags here
 *      means we never issue that syscall at all.
 */
static int cr_validate_args(unsigned int first, unsigned int last, unsigned int flags)
{
	if (flags & ~(CLOSE_RANGE_UNSHARE | CLOSE_RANGE_CLOEXEC)) {
		errno = EINVAL;
		return -1;
	}
	if (first > last) {
		errno = EINVAL;
		return -1;
	}
	return 0;
}

/* Shared dispatch for both entry points below (once args are validated).
 * flags==0 is the one exact combination cr_probe_syscall() already proved
 * safe, so it takes the cheap unguarded path once WORKS is cached; any
 * other flags value gets its own guarded attempt (see
 * shim_guarded_syscall) since e.g. CLOSE_RANGE_UNSHARE was found to
 * independently SIGSYS on this device even after a flags=0 probe
 * succeeded — and a SIGSYS there downgrades the cached state to FALLBACK
 * so later calls skip straight to the safe path instead of re-discovering
 * the same crash. */
static int cr_dispatch(unsigned int first, unsigned int last, unsigned int flags)
{
	if (__builtin_expect(cr_probe_state == CR_PROBE_UNKNOWN, 0))
		cr_probe_syscall();

	if (cr_probe_state == CR_PROBE_WORKS) {
		if (flags == 0) {
			long ret = cr_real_syscall(__NR_close_range, (long)first,
						  (long)last, 0, 0, 0, 0);
			if (ret == 0 || errno != ENOSYS)
				return (int)ret;
		} else {
			long ret;
			if (shim_guarded_syscall(__NR_close_range, (long)first, (long)last,
						 (long)flags, 0, 0, 0, &ret)) {
				if (ret == 0 || errno != ENOSYS)
					return (int)ret;
			} else {
				cr_probe_state = CR_PROBE_FALLBACK;
			}
		}
	}
	return cr_do_fallback(first, last, flags);
}

int close_range(unsigned int first, unsigned int last, unsigned int flags)
{
	/* Disabled means "don't intercept" — defer entirely to the real
	 * syscall, same as if this shim weren't loaded at all, including
	 * skipping our own EINVAL validation above. No probe, no fallback
	 * safety net: if the real call gets SIGSYS'd, so does the caller,
	 * exactly matching genuine no-shim behavior. */
	if (shim_disabled("close_range")) {
		return (int)cr_real_syscall(__NR_close_range, (long)first,
					    (long)last, (long)flags, 0, 0, 0);
	}
	if (cr_validate_args(first, last, flags) != 0)
		return -1;
	return cr_dispatch(first, last, flags);
}

/* Forward-declared: fc2_dispatch() is implemented in fchmodat2's own
 * section below (after syscall(), which needs to call it here). */
static int fc2_dispatch(int dirfd, const char *path, mode_t mode, int flags);

/* Forward-declared: ep_shim_ctl_done() lives in the epoll_pipe section
 * below — it runs the registry bookkeeping after a successful real
 * epoll_ctl(), no matter which entry symbol carried the call. */
static int ep_shim_ctl_done(int rc, int epfd, int op, int fd,
			    struct epoll_event *ev);

/* syscall() override — dispatches the small set of raw-syscall-numbers
 * this file intercepts (currently close_range and fchmodat2 — see each
 * one's own section); every other number passes straight through to the
 * real (RTLD_NEXT) syscall() unmodified. */
long syscall(long number, ...)
{
	va_list ap;
	long a0, a1, a2, a3, a4, a5;

	va_start(ap, number);
	a0 = va_arg(ap, long);
	a1 = va_arg(ap, long);
	a2 = va_arg(ap, long);
	a3 = va_arg(ap, long);
	a4 = va_arg(ap, long);
	a5 = va_arg(ap, long);
	va_end(ap);

	if (number == __NR_close_range && !shim_disabled("close_range")) {
		unsigned int first = (unsigned int)a0;
		unsigned int last = (unsigned int)a1;
		unsigned int flags = (unsigned int)a2;
		if (cr_validate_args(first, last, flags) != 0)
			return -1;
		return cr_dispatch(first, last, flags);
	}

	if (number == __NR_fchmodat2 && !shim_disabled("fchmodat2")) {
		return fc2_dispatch((int)a0, (const char *)a1, (mode_t)a2, (int)a3);
	}

	/* Bun's Rust event loop (src/sys/linux_syscall.rs) issues epoll_ctl
	 * as a raw syscall(SYS_epoll_ctl, ...) rather than the libc symbol,
	 * so the epoll_ctl() override below never sees those calls. Route
	 * them through the same registry bookkeeping here. cr_real_syscall
	 * is libc's syscall(): libc-convention return, errno set on -1. */
	if (number == __NR_epoll_ctl && !shim_disabled("epoll_pipe")) {
		return ep_shim_ctl_done(
			(int)cr_real_syscall(__NR_epoll_ctl, a0, a1, a2, a3, 0, 0),
			(int)a0, (int)a1, (int)a2, (struct epoll_event *)a3);
	}

	return cr_real_syscall(number, a0, a1, a2, a3, a4, a5);
}

/* ==================================================================== */
/*  1.5. fchmodat2() — syscall 452, chmod with AT_* flags (mainly         */
/*       AT_SYMLINK_NOFOLLOW). No libc wrapper exists for this in this   */
/*       musl (too new; same situation close_range was in) — callers use */
/*       syscall(SYS_fchmodat2, ...) directly, e.g. Bun's `add` command   */
/*       setting permissions. Confirmed on-device: raises an unhandled   */
/*       SIGSYS on real HarmonyOS hardware regardless of arguments, same */
/*       failure mode as close_range (not a graceful ENOSYS) — verified  */
/*       with a standalone guarded repro before writing this. Falls back */
/*       to the classic fchmodat(), forwarding AT_SYMLINK_NOFOLLOW —     */
/*       this musl honours it (measured below). Simpler than             */
/*       close_range: no evidence different flag values change the       */
/*       SIGSYS outcome here (there's no second underlying syscall like  */
/*       unshare() to independently trip), so one process-wide probe is  */
/*       trusted rather than re-guarding every call.                     */
/* ==================================================================== */

enum { FC2_PROBE_UNKNOWN, FC2_PROBE_WORKS, FC2_PROBE_FALLBACK };
static int fc2_probe_state = FC2_PROBE_UNKNOWN;

static void fc2_probe(int dirfd, const char *path)
{
	long ret;
	struct stat st;
	if (fstatat(dirfd, path, &st, 0) != 0) {
		fc2_probe_state = FC2_PROBE_FALLBACK;
		return;
	}
	if (shim_guarded_syscall(__NR_fchmodat2, dirfd, (long)path,
				 (long)(st.st_mode & 07777), 0, 0, 0, &ret) &&
	    ret == 0)
		fc2_probe_state = FC2_PROBE_WORKS;
	else
		fc2_probe_state = FC2_PROBE_FALLBACK;
}

static int fc2_dispatch(int dirfd, const char *path, mode_t mode, int flags)
{
	if (__builtin_expect(fc2_probe_state == FC2_PROBE_UNKNOWN, 0))
		fc2_probe(dirfd, path);

	if (fc2_probe_state == FC2_PROBE_WORKS) {
		long ret;
		if (shim_guarded_syscall(__NR_fchmodat2, dirfd, (long)path, (long)mode,
					 flags, 0, 0, &ret)) {
			if (ret == 0 || errno != ENOSYS)
				return (int)ret;
		} else {
			fc2_probe_state = FC2_PROBE_FALLBACK;
		}
	}

	/* Fallback: classic fchmodat(), forwarding AT_SYMLINK_NOFOLLOW.
	 *
	 * This used to drop the flag, on the assumption that classic fchmodat()
	 * could not honour it. Measured on this device, it can:
	 *
	 *   regular file + NOFOLLOW -> rc=0, mode applied
	 *   directory    + NOFOLLOW -> rc=0, mode applied
	 *   symlink      + NOFOLLOW -> rc=-1 ENOTSUP, target untouched
	 *
	 * which is exactly Linux's contract (a symlink's own mode bits are
	 * meaningless, so chmod on one is refused). Dropping the flag was
	 * therefore not just lossy but unsafe: it turned "do not follow this
	 * symlink" into "follow it", so a chmod aimed at a link landed on
	 * whatever the link pointed at. bun's installer relies on the refusal
	 * to avoid chmod-ing a file outside the package via a symlinked bin
	 * target (test/cli/install/symlink-path-traversal.test.ts).
	 *
	 * Other fchmodat2-only flags (AT_EMPTY_PATH) stay dropped: classic
	 * fchmodat() would reject them outright and no caller here uses them. */
	return fchmodat(dirfd, path, mode, flags & AT_SYMLINK_NOFOLLOW);
}

/* ==================================================================== */
/*  2. getpwuid_r() — HarmonyOS HAP uids (2002xxxx) aren't in /etc/passwd */
/*     Real impl returns ENOENT/0-with-NULL-result; synthesize a minimal */
/*     passwd record matching Node's os.userInfo() needs. When the query */
/*     is for the caller's own uid, prefer the real OS-account name from */
/*     libos_account_ndk.so (OH_OsAccount_GetName, API 12+), then env    */
/*     vars, then a uid-derived placeholder.                             */
/* ==================================================================== */

#ifndef LOGIN_NAME_MAX
#define LOGIN_NAME_MAX 256
#endif

typedef int (*getpwuid_r_fn)(uid_t, struct passwd *, char *, size_t, struct passwd **);

/* Lazily resolve OH_OsAccount_GetName; cache the handle and symbol for the
 * process lifetime (getpwuid_r() is called repeatedly, e.g. by Node's
 * os.userInfo()). Returns NULL when the library or symbol is unavailable,
 * so callers transparently fall back to env-var synthesis. */
typedef int (*ohos_get_name_fn)(char *, size_t);

static ohos_get_name_fn ohos_get_name_resolve(void)
{
	static void *handle = NULL;
	static ohos_get_name_fn fn = NULL;
	if (!handle) {
		handle = dlopen("libos_account_ndk.so", RTLD_NOW | RTLD_LOCAL);
		if (handle)
			fn = (ohos_get_name_fn)dlsym(handle, "OH_OsAccount_GetName");
	}
	return fn;
}

int getpwuid_r(uid_t uid, struct passwd *pwd, char *buf, size_t buflen,
	      struct passwd **result)
{
	static getpwuid_r_fn real = NULL;
	if (!real)
		real = (getpwuid_r_fn)dlsym(RTLD_NEXT, "getpwuid_r");

	if (!shim_disabled("getpwuid_r") && real) {
		int rc = real(uid, pwd, buf, buflen, result);
		if (rc == 0 && *result != NULL)
			return 0; /* real lookup succeeded, use it */
		if (rc != 0 && rc != ENOENT)
			return rc; /* a different real error, don't mask it */
	} else if (real) {
		return real(uid, pwd, buf, buflen, result);
	}

	if (shim_disabled("getpwuid_r")) {
		*result = NULL;
		return ENOENT;
	}

	/* Only synthesize for the caller's own uid — the fallback record IS the
	 * current OS account, so handing it out for an arbitrary uid would mask
	 * the ENOENT that callers rely on (Node's process.initgroups() numeric
	 * pre-resolve expects ERR_UNKNOWN_CREDENTIAL for unknown uids). */
	if (uid != getuid() && uid != geteuid()) {
		*result = NULL;
		return ENOENT;
	}

	/* Fallback: synthesize from the OS-account name (only valid for the
	 * caller's own uid — the account API has no uid parameter), then
	 * environment, mirroring ohos-preflight/solutions/i9_getpwuid_r.c.
	 * A set-but-empty var (e.g. `export LOGNAME=`) is treated the same
	 * as unset. */
	const char *username = NULL;
	char account_name[LOGIN_NAME_MAX];
	if (uid == getuid()) {
		ohos_get_name_fn get_name = ohos_get_name_resolve();
		if (get_name && get_name(account_name, sizeof(account_name)) == 0)
			username = account_name;
	}
	if (!username) {
		username = getenv("LOGNAME");
		if (username && !*username)
			username = NULL;
	}
	if (!username) {
		username = getenv("USER");
		if (username && !*username)
			username = NULL;
	}
	const char *homedir = getenv("HOME");
	if (homedir && !*homedir)
		homedir = NULL;
	if (!homedir)
		homedir = "/data/storage/el2/base";
	const char *shell = getenv("SHELL");
	if (shell && !*shell)
		shell = NULL;
	if (!shell)
		shell = "/bin/false";

	char uid_buf[32];
	if (!username) {
		snprintf(uid_buf, sizeof(uid_buf), "u%u", (unsigned)uid);
		username = uid_buf;
	}

	size_t need = strlen(username) + 1 + strlen(homedir) + 1 + strlen(shell) + 1;
	if (buflen < need) {
		*result = NULL;
		return ERANGE;
	}

	char *p = buf;
	pwd->pw_name = p;
	p = stpcpy(p, username) + 1;
	pwd->pw_dir = p;
	p = stpcpy(p, homedir) + 1;
	pwd->pw_shell = p;
	stpcpy(p, shell);

	pwd->pw_passwd = (char *)"";
	pwd->pw_uid = uid;
	pwd->pw_gid = getegid();
	pwd->pw_gecos = pwd->pw_name;

	*result = pwd;
	return 0;
}

/* ==================================================================== */
/*  3. tmpfile() — P_tmpdir is unwritable in the HarmonyOS app sandbox;  */
/*     fall back to an unlinked file under $HOME.                       */
/* ==================================================================== */

typedef FILE *(*tmpfile_fn)(void);

FILE *tmpfile(void)
{
	static tmpfile_fn real = NULL;
	if (!real)
		real = (tmpfile_fn)dlsym(RTLD_NEXT, "tmpfile");

	if (!shim_disabled("tmpfile") && real) {
		FILE *f = real();
		if (f)
			return f;
		/* fall through to userspace fallback below */
	} else if (real) {
		return real();
	}

	if (shim_disabled("tmpfile"))
		return NULL;

	const char *dir = getenv("TMPDIR");
	if (!dir)
		dir = getenv("HOME");
	if (!dir)
		dir = "/data/storage/el2/base";

	char tmpl[PATH_MAX];
	int n = snprintf(tmpl, sizeof(tmpl), "%s/ohos-compat-tmp-XXXXXX", dir);
	if (n < 0 || (size_t)n >= sizeof(tmpl)) {
		errno = ENAMETOOLONG;
		return NULL;
	}

	int fd = mkstemp(tmpl);
	if (fd < 0)
		return NULL;
	unlink(tmpl); /* auto-cleanup on close/exit, matches tmpfile() semantics */

	FILE *f = fdopen(fd, "w+");
	if (!f) {
		int saved_errno = errno;
		close(fd);
		errno = saved_errno;
		return NULL;
	}
	return f;
}

/* ==================================================================== */
/*  4. getcwd() — cwd removed out from under the process (lifecycle      */
/*     scripts, `rm -rf` of a worktree) returns ENOENT on both OH and    */
/*     HM; fall back to $HOME so callers get a valid path instead of     */
/*     erroring out entirely. Default ON, opt-out via                   */
/*     OHOS_COMPAT_SHIM_DISABLE=getcwd.                                 */
/* ==================================================================== */

/* Copy a NUL-terminated cwd candidate into the caller's buffer (or a freshly
 * malloc'd one when buf==NULL, per getcwd(3)'s GNU auto-allocate extension),
 * honoring the size/ERANGE contract. Returns buf/out on success, NULL+ERANGE
 * on a too-small caller buffer, NULL+ENOMEM on malloc failure. */
static char *cwd_copy_out(const char *src, char *buf, size_t size)
{
	size_t need = strlen(src) + 1;
	if (buf) {
		if (size < need) {
			errno = ERANGE;
			return NULL;
		}
		memcpy(buf, src, need);
		return buf;
	}
	size_t alloc_size = size ? size : need;
	if (alloc_size < need) {
		errno = ERANGE;
		return NULL;
	}
	char *out = malloc(alloc_size);
	if (!out)
		return NULL;
	memcpy(out, src, need);
	return out;
}

typedef char *(*getcwd_fn)(char *, size_t);

char *getcwd(char *buf, size_t size)
{
	static getcwd_fn real = NULL;
	if (!real)
		real = (getcwd_fn)dlsym(RTLD_NEXT, "getcwd");

	char *r = real ? real(buf, size) : NULL;
	if (r || shim_disabled("getcwd"))
		return r;
	/* Only engage the fallback on "couldn't resolve the cwd" errors (EACCES:
	 * an ancestor lacks +x on hmdfs/tmpfs; ENOENT: cwd rmdir'd). Argument/
	 * buffer errors (EINVAL size=0, ERANGE buf-too-small, EFAULT) must pass
	 * through untouched so callers see the real errno. */
	if (errno != EACCES && errno != ENOENT)
		return r;
	/* getcwd()'s userspace parent-walk (readdir("..") up to /) needs +x on
	 * every ancestor; HarmonyOS sandbox dirs on hmdfs/tmpfs and rmdir'd
	 * cwds trip it with EACCES/ENOENT. The kernel still knows the real cwd:
	 * /proc/self/cwd is resolved server-side via d_path() with NO userspace
	 * permission check, so it succeeds exactly where getcwd()'s walk fails
	 * and yields the REAL cwd — what bash and lifecycle scripts actually
	 * need, not a $HOME guess. (This is what lets bun drop its ohos_set_pwd
	 * / cd-prefix workarounds once the shim is preloaded.) */
	char proc_buf[PATH_MAX];
	ssize_t n = readlink("/proc/self/cwd", proc_buf, sizeof(proc_buf) - 1);
	if (n > 0) {
		proc_buf[n] = '\0';
		struct stat st;
		/* Trust the kernel-reported path unless it is provably gone: stat
		 * ENOENT means the cwd was rmdir'd (a dangling path is worse than
		 * $HOME), so fall through. Any other stat outcome (success, or an
		 * EACCES on an ancestor that doesn't invalidate the path) keeps it. */
		if (stat(proc_buf, &st) == 0 || errno != ENOENT)
			return cwd_copy_out(proc_buf, buf, size);
	}

	/* Last resort: somewhere valid so the caller doesn't hard-crash. */
	const char *home = getenv("HOME");
	if (!home)
		home = "/data/storage/el2/base";
	return cwd_copy_out(home, buf, size);
}

/* ==================================================================== */
/*  5. linkat()/symlinkat() — sandboxed target dirs return EPERM/EACCES  */
/*     for hardlinks; fall back to a byte copy (linkat) or, for          */
/*     symlinkat, a copy of the link *target file* when it exists.      */
/*     Semantically lossy (loses hardlink/symlink identity — a later     */
/*     symlink target cannot be copied). Default ON since 0.2.0 (bun          */
/*     install needs hardlinks and the sandbox blocks the real linkat         */
/*     for all apps). Disable individually via                                */
/*     OHOS_COMPAT_SHIM_DISABLE=linkat,symlinkat if true link semantics       */
/*     matter for your workload.                                              */
static int copy_fd_contents(int src_fd, int dst_fd)
{
	char buf[65536];
	ssize_t n;
	while ((n = read(src_fd, buf, sizeof(buf))) > 0) {
		ssize_t off = 0;
		while (off < n) {
			ssize_t w = write(dst_fd, buf + off, (size_t)(n - off));
			if (w < 0) {
				if (errno == EINTR)
					continue;
				return -1;
			}
			off += w;
		}
	}
	return (n < 0) ? -1 : 0;
}

/* Copy src_fd to newdirfd/newpath atomically: write a hidden sibling temp
 * file, then renameat() into place. The previous direct O_CREAT|O_EXCL +
 * copy made the destination visible at 0 bytes the moment it was created,
 * so a concurrent quick_exit (bun install aborting on a resolution error
 * while a worker thread is still flushing its npm manifest cache) left
 * permanently corrupt 0-byte cache entries ("manifest is invalid" on the
 * next load — bun-install-registry prereleases-* tests). With tmp+rename
 * the destination appears complete or not at all; a quick_exit mid-copy
 * only litters a hidden temp file.
 *
 * EEXIST semantics: real linkat fails if newpath exists. renameat would
 * silently replace it, so pre-check with fstatat; the tiny TOCTOU window
 * between check and rename is inherent to an emulation and harmless for
 * the cache-writer workloads this shim serves (they unlink+retry anyway). */
static int copy_fd_to_path_atomic(int src_fd, int newdirfd, const char *newpath,
				  mode_t mode)
{
	/* The temp file MUST live in newpath's own directory: renameat is
	 * same-filesystem only, and an absolute newpath with a bare temp name
	 * would put the temp in the process CWD (possibly another fs → EXDEV). */
	char tmp[PATH_MAX];
	const char *slash = strrchr(newpath, '/');
	size_t dirlen = slash ? (size_t)(slash - newpath) + 1 : 0;
	if (dirlen >= sizeof(tmp))
		return -1;
	int len = snprintf(tmp, sizeof(tmp), "%.*s.ohos-linkat-tmp.%d",
			   (int)dirlen, newpath, (int)getpid());
	if (len <= 0 || len >= (int)sizeof(tmp))
		return -1;

	int dst = -1;
	for (int i = 0; i < 100; i++) {
		char *p = tmp + len;
		if (i > 0)
			snprintf(p, sizeof(tmp) - len, ".%d", i);
		dst = openat(newdirfd, tmp,
			     O_WRONLY | O_CREAT | O_EXCL | O_TRUNC, mode);
		if (dst >= 0)
			break;
		if (errno != EEXIST)
			return -1;
	}
	if (dst < 0)
		return -1;

	int copy_rc = copy_fd_contents(src_fd, dst);
	int e = errno;
	close(dst);
	if (copy_rc != 0) {
		unlinkat(newdirfd, tmp, 0);
		errno = e;
		return -1;
	}

	struct stat st;
	if (fstatat(newdirfd, newpath, &st, AT_SYMLINK_NOFOLLOW) == 0) {
		unlinkat(newdirfd, tmp, 0);
		errno = EEXIST;
		return -1;
	}

	if (renameat(newdirfd, tmp, newdirfd, newpath) != 0) {
		e = errno;
		unlinkat(newdirfd, tmp, 0);
		errno = e;
		return -1;
	}
	return 0;
}

typedef int (*linkat_fn)(int, const char *, int, const char *, int);

/* ------------------------------------------------------------------ */
/*  splice(2): EOF on the source is reported as EPIPE instead of 0      */
/* ------------------------------------------------------------------ */
/*
 * This kernel returns -1/EPIPE from splice() when the *source* pipe is at
 * end-of-file, where Linux returns 0. read() on that same pipe correctly
 * returns 0, so only the splice path is affected. Every splice-based copy
 * loop therefore mistakes a normal EOF for a fatal error: GNU coreutils'
 * cat takes that path whenever stdin and stdout are both pipes and prints
 * "cat: -: Broken pipe" then exits 1. Measured with a standalone probe,
 * no Bun involved.
 *
 * A genuine EPIPE (the destination's read end is gone) must still be
 * reported. poll() separates the two cleanly and is non-destructive --
 * unlike read(), it cannot consume the byte we are asked to move:
 *
 *   source at EOF        poll(fd_in)=POLLIN|POLLHUP  poll(fd_out)=POLLOUT
 *   destination broken   poll(fd_in)=POLLIN          poll(fd_out)=POLLOUT|POLLERR
 *   both at once         poll(fd_out)=POLLOUT|POLLERR
 *
 * So POLLERR on the destination decides it. Checking the destination FIRST
 * makes the ambiguous "both" case resolve to the real error, which is the
 * conservative direction: reporting a broken pipe that also happens to be
 * at EOF loses nothing, whereas swallowing a real EPIPE would silently
 * truncate a copy.
 *
 * Only reached when splice() has already failed with EPIPE; every other
 * outcome is passed through untouched, so the cost on the normal path is
 * one comparison. Note POLLIN is set on an EOF pipe too (a read would
 * return 0 immediately), which is why POLLHUP -- not the absence of
 * POLLIN -- is the EOF signal.
 */
typedef ssize_t (*splice_fn)(int, off_t *, int, off_t *, size_t, unsigned int);

/* ------------------------------------------------------------------ */
/*  splice(2), second defect: writing to a pipe wakes no poll()/epoll   */
/* ------------------------------------------------------------------ */
/*
 * Bytes that splice() places into a pipe never wake a poll() or
 * epoll_wait() that is already blocked on that pipe's read end. The data
 * really is there -- a later poll, or a read(), sees it immediately -- so
 * the pipe's readiness *state* is right and only the *wakeup* is missing.
 * A reader blocked in read() is woken correctly, which is why the defect
 * hides behind anything that reads synchronously.
 *
 * Measured with a standalone probe (no Bun involved), waiter blocked
 * first, 4096 bytes sent 300ms later:
 *
 *   waiter        fed by splice()        fed by write()
 *   poll          2000ms timeout         woken in 300ms
 *   epoll LT      2000ms timeout         woken in 301ms
 *   epoll ET      2000ms timeout         woken in 301ms
 *   read          woken in 301ms         woken in 301ms
 *
 * It deadlocks any pipeline whose consumer polls: GNU cat feeds stdout
 * with splice() when it is a pipe, so `cat big | bun script.js` hangs
 * forever -- Bun sits in epoll_wait, cat fills the 512KB pipe and then
 * blocks in splice() too. `cat big | wc -c` is fine (wc blocks in read),
 * and `dd ... | bun script.js` is fine (dd uses write).
 *
 * Fix: when the destination is a pipe, move the bytes through a userspace
 * buffer so the pipe is fed by write(), whose wakeup works. That costs one
 * copy and gives up splice's zero-copy property on this path, which is the
 * right trade for a shim whose job is correctness.
 *
 * Holding the last byte back and sending only that one with write() would
 * have kept the zero-copy bulk transfer, and a probe confirmed it wakes the
 * poller -- but it does not survive the real case: cat asks for 524288
 * bytes into a 512KB pipe, splice fills the pipe and returns short, and the
 * trailing write() is never reached. A wakeup scheme that fails exactly
 * when the pipe is full is no use, since that is when the reader is
 * guaranteed to be waiting.
 */
#ifndef SPLICE_F_NONBLOCK
#define SPLICE_F_NONBLOCK 2
#endif

static int splice_fd_is_fifo(int fd)
{
	struct stat st;
	return fstat(fd, &st) == 0 && S_ISFIFO(st.st_mode);
}

/*
 * One bounded chunk, source -> userspace -> destination. Returning less than
 * `len` is allowed by splice(2) and every splice-based copy loop already
 * handles it, so a 64KB ceiling costs nothing but bounds the stack.
 */
static ssize_t splice_through_buffer(int fd_in, off_t *off_in, int fd_out,
				     size_t len, unsigned int flags)
{
	char buf[65536];
	if (len > sizeof buf)
		len = sizeof buf;

	/* SPLICE_F_NONBLOCK promises not to block on the source; read() alone
	   would, unless fd_in itself is O_NONBLOCK. POLLHUP-without-POLLIN
	   still reports ready, so EOF keeps flowing through to the read(). */
	if (flags & SPLICE_F_NONBLOCK) {
		struct pollfd pfd = { .fd = fd_in, .events = POLLIN };
		if (poll(&pfd, 1, 0) <= 0) {
			errno = EAGAIN;
			return -1;
		}
	}

	ssize_t got = off_in ? pread(fd_in, buf, len, *off_in)
			     : read(fd_in, buf, len);
	if (got <= 0)
		return got;	/* 0 is EOF -- the answer splice() should give */

	/* These bytes are already out of the source, so a short write cannot
	   be reported back as "not consumed" the way splice() would: it has to
	   be retried or the data is gone. That means a SPLICE_F_NONBLOCK caller
	   can still block here on a full destination. Losing bytes is the worse
	   failure, and the alternative (peek at pipe space first) has no
	   portable form. */
	size_t done = 0;
	while (done < (size_t)got) {
		ssize_t w = write(fd_out, buf + done, (size_t)got - done);
		if (w > 0) {
			done += (size_t)w;
			continue;
		}
		if (w < 0 && errno == EINTR)
			continue;
		if (w < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
			struct pollfd pfd = { .fd = fd_out, .events = POLLOUT };
			if (poll(&pfd, 1, -1) < 0 && errno != EINTR)
				break;
			continue;
		}
		break;		/* EPIPE and friends: report what did land */
	}
	if (done == 0)
		return -1;	/* errno still set by write() */
	if (off_in)
		*off_in += (off_t)done;
	return (ssize_t)done;
}

ssize_t splice(int fd_in, off_t *off_in, int fd_out, off_t *off_out,
	       size_t len, unsigned int flags)
{
	static splice_fn real = NULL;
	if (!real)
		real = (splice_fn)dlsym(RTLD_NEXT, "splice");
	if (!real) {
		errno = ENOSYS;
		return -1;
	}

	/* off_out must be NULL when the destination is a pipe (kernel rule);
	   testing it as well keeps this path off any call the kernel would
	   have rejected anyway. */
	if (len > 0 && off_out == NULL && !shim_disabled("splice") &&
	    splice_fd_is_fifo(fd_out))
		return splice_through_buffer(fd_in, off_in, fd_out, len, flags);

	ssize_t rc = real(fd_in, off_in, fd_out, off_out, len, flags);
	if (rc >= 0 || errno != EPIPE)
		return rc;
	if (shim_disabled("splice"))
		return rc;

	int saved = errno;

	/* Destination genuinely broken? Then EPIPE is the correct answer. */
	struct pollfd out_pfd = { .fd = fd_out, .events = POLLOUT };
	if (poll(&out_pfd, 1, 0) > 0 && (out_pfd.revents & (POLLERR | POLLNVAL))) {
		errno = saved;
		return rc;
	}

	/* Source hung up with nothing left to move: that is a plain EOF. */
	struct pollfd in_pfd = { .fd = fd_in, .events = POLLIN };
	if (poll(&in_pfd, 1, 0) > 0 && (in_pfd.revents & POLLHUP))
		return 0;

	errno = saved;
	return rc;
}

/* ==================================================================== */
/*  epoll/poll pipe-readiness repair (OHOS_TEST_STATUS.md T50)          */
/* ==================================================================== */
/*
 * Third pipe defect on HarmonyOS, distinct from the two splice() ones
 * above: a shell-created pipe (e.g. `cat big | bun script.js`) can lose
 * its read-readiness *state* entirely. Bytes sit in the pipe buffer
 * (FIONREAD reports them), but poll() and epoll_wait() -- even a freshly
 * created epoll instance registering the fd for the first time -- report
 * the fd as not-readable, and stay wrong after bytes are drained. Node.js
 * as the reader hangs the same way, so this is a kernel pipe-state bug,
 * not a Bun one. The repro rate tracks system load (near 100% under
 * memory pressure, sporadic when idle).
 *
 * Bun cannot avoid the affected object -- the shell owns the write end --
 * so this shim repairs readiness in userspace:
 *
 *   epoll_ctl(ADD/MOD)  remember (epfd, fd, event) for FIFO fds whose
 *                       mask asks for EPOLLIN; DEL forgets. Calls arrive
 *                       both via the libc symbol (usockets) and via raw
 *                       syscall(SYS_epoll_ctl) (Bun's Rust event loop) --
 *                       the syscall() override above funnels the latter
 *                       into the same bookkeeping.
 *   epoll_wait/pwait    when any pipe is registered on this epfd, poll
 *                       internally in EP_PIPE_POLL_MS slices and, on an
 *                       empty return, FIONREAD each registered pipe and
 *                       synthesize EPOLLIN with the registered udata for
 *                       those with bytes pending. The slicing is HIDDEN
 *                       from the caller: an empty slice is answered by
 *                       re-waiting, never by returning 0, until the
 *                       caller's own timeout genuinely expires (an
 *                       infinite wait must only return with an event or
 *                       signal — libuv's uv__io_poll asserts exactly
 *                       that, and the leaked premature 0 crashed pnpm
 *                       with SIGABRT).
 *   poll/ppoll          after the real call, patch revents for FIFO fds
 *                       that asked for POLLIN, reported nothing, yet
 *                       have bytes pending (covers is_readable paths).
 *   close               drop registry entries naming the closing fd
 *                       (whether it was an epfd or a pipe), so a reused
 *                       fd number never inherits stale udata.
 *
 * EOF: the corrupted kernel never delivers EPOLLHUP either, so after the
 * last byte is drained the reader would still wait forever. When a
 * pipe's FIONREAD transitions had-data -> empty, one final EPOLLIN is
 * synthesized: at EOF the read returns 0 (correct), otherwise it is a
 * single harmless EAGAIN wakeup.
 *
 * EPOLLONESHOT: a synthesized event is delivered without the kernel
 * having fired, so the entry is marked disarmed and gets no further
 * synthesized events until the next MOD re-arms it -- mirroring kernel
 * semantics from the caller's point of view.
 *
 * This is a workaround, not a cure; the kernel bug should be reported to
 * the platform side (fd0-reader3/fd0-reader4 probes as evidence).
 * OHOS_COMPAT_SHIM_DISABLE=epoll_pipe turns the whole interceptor off.
 */

#define EP_PIPE_POLL_MS 250
#define EP_REG_MAX 64

typedef struct {
	int used;
	int epfd;
	int fd;
	struct epoll_event ev;	/* registration mask + udata */
	int disarmed;		/* ONESHOT: synthesized event delivered */
	int had_data;		/* FIONREAD was non-zero at last check */
} ep_pipe_reg_t;

static ep_pipe_reg_t g_ep_pipes[EP_REG_MAX];
static pthread_mutex_t g_ep_pipes_lock = PTHREAD_MUTEX_INITIALIZER;

static int ep_pipe_active(void)
{
	return !shim_disabled("epoll_pipe");
}

/* All registry mutations happen under g_ep_pipes_lock; Bun runs one
 * epoll instance per event-loop thread, so epoll_ctl for different epfds
 * really can arrive concurrently. */

static void ep_reg_update_locked(int epfd, int fd, const struct epoll_event *ev)
{
	int free_slot = -1, i;
	for (i = 0; i < EP_REG_MAX; i++) {
		if (!g_ep_pipes[i].used) {
			if (free_slot < 0)
				free_slot = i;
			continue;
		}
		if (g_ep_pipes[i].epfd == epfd && g_ep_pipes[i].fd == fd) {
			g_ep_pipes[i].ev = *ev;
			g_ep_pipes[i].disarmed = 0;
			/* had_data deliberately kept: a MOD re-arm right
			 * after the reader drained the pipe must not lose
			 * the pending EOF transition. */
			return;
		}
	}
	if (free_slot < 0)
		return;	/* full: this pipe just never gets repaired */
	g_ep_pipes[free_slot].used = 1;
	g_ep_pipes[free_slot].epfd = epfd;
	g_ep_pipes[free_slot].fd = fd;
	g_ep_pipes[free_slot].ev = *ev;
	g_ep_pipes[free_slot].disarmed = 0;
	g_ep_pipes[free_slot].had_data = 0;
}

static void ep_reg_del_locked(int epfd, int fd)
{
	int i;
	for (i = 0; i < EP_REG_MAX; i++)
		if (g_ep_pipes[i].used && g_ep_pipes[i].epfd == epfd &&
		    g_ep_pipes[i].fd == fd)
			g_ep_pipes[i].used = 0;
}

static void ep_reg_forget_fd_locked(int fd)
{
	int i;
	for (i = 0; i < EP_REG_MAX; i++)
		if (g_ep_pipes[i].used &&
		    (g_ep_pipes[i].fd == fd || g_ep_pipes[i].epfd == fd))
			g_ep_pipes[i].used = 0;
}

static int ep_reg_any_locked(int epfd)
{
	int i;
	for (i = 0; i < EP_REG_MAX; i++)
		if (g_ep_pipes[i].used && g_ep_pipes[i].epfd == epfd)
			return 1;
	return 0;
}

/* Registry bookkeeping after a real epoll_ctl(), shared by the libc
 * symbol override and the syscall(SYS_epoll_ctl) dispatcher. */
static int ep_shim_ctl_done(int rc, int epfd, int op, int fd,
			    struct epoll_event *ev)
{
	if (rc != 0 || !ep_pipe_active())
		return rc;
	pthread_mutex_lock(&g_ep_pipes_lock);
	if (op == EPOLL_CTL_DEL) {
		ep_reg_del_locked(epfd, fd);
	} else if (ev && (ev->events & EPOLLIN) && splice_fd_is_fifo(fd)) {
		ep_reg_update_locked(epfd, fd, ev);
	} else {
		/* No EPOLLIN requested, or not a pipe: make sure a
		 * recycled fd number doesn't stay tracked from a previous
		 * registration. */
		ep_reg_del_locked(epfd, fd);
	}
	pthread_mutex_unlock(&g_ep_pipes_lock);
	return rc;
}

typedef int (*epoll_ctl_fn)(int, int, int, struct epoll_event *);

int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event)
{
	static epoll_ctl_fn real = NULL;
	if (!real)
		real = (epoll_ctl_fn)dlsym(RTLD_NEXT, "epoll_ctl");
	if (!real) {
		errno = ENOSYS;
		return -1;
	}
	return ep_shim_ctl_done(real(epfd, op, fd, event), epfd, op, fd, event);
}

/* Clamp long waits to the poll interval when this epfd has pipes under
 * repair; short and zero (nonblocking) timeouts pass through. */
static int ep_shim_clamp_timeout(int epfd, int timeout)
{
	int any;
	if (timeout == 0 || !ep_pipe_active())
		return timeout;
	if (timeout > 0 && timeout <= EP_PIPE_POLL_MS)
		return timeout;
	pthread_mutex_lock(&g_ep_pipes_lock);
	any = ep_reg_any_locked(epfd);
	pthread_mutex_unlock(&g_ep_pipes_lock);
	return any ? EP_PIPE_POLL_MS : timeout;
}

/* After an empty real wait, synthesize EPOLLIN for registered pipes with
 * bytes pending (plus the one-shot drained/EOF wakeup described above). */
static int ep_shim_after_wait(int rc, int epfd, struct epoll_event *events,
			      int maxevents)
{
	int i, n = 0;
	if (rc != 0 || maxevents <= 0 || !ep_pipe_active())
		return rc;
	pthread_mutex_lock(&g_ep_pipes_lock);
	for (i = 0; i < EP_REG_MAX && n < maxevents; i++) {
		int avail = 0;
		if (!g_ep_pipes[i].used || g_ep_pipes[i].epfd != epfd ||
		    g_ep_pipes[i].disarmed)
			continue;
		if (ioctl(g_ep_pipes[i].fd, FIONREAD, &avail) != 0) {
			/* fd is gone; the kernel drops closed fds from the
			 * epoll set too, so stop tracking it here. */
			g_ep_pipes[i].used = 0;
			continue;
		}
		if (avail > 0) {
			g_ep_pipes[i].had_data = 1;
		} else if (g_ep_pipes[i].had_data) {
			g_ep_pipes[i].had_data = 0;
		} else {
			continue;
		}
		if (g_ep_pipes[i].ev.events & EPOLLONESHOT)
			g_ep_pipes[i].disarmed = 1;
		events[n].events = EPOLLIN;
		events[n].data = g_ep_pipes[i].ev.data;
		n++;
	}
	pthread_mutex_unlock(&g_ep_pipes_lock);
	return n;
}

typedef int (*epoll_pwait_fn)(int, struct epoll_event *, int, int,
			      const sigset_t *);

static long long ep_now_ms(void)
{
	struct timespec ts;
	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (long long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

/* Wait with the repair slice ep_shim_clamp_timeout() dictates, but WITHOUT
 * leaking the slicing to the caller: an empty 250ms repair poll is answered
 * by re-waiting, never by returning 0, until the caller's own timeout
 * genuinely expires. A premature 0 violates the epoll_wait contract — for
 * timeout == -1 the kernel returns only with an event or a signal — and
 * crashed libuv (uv__io_poll: "assert(timeout != -1)" when nfds == 0;
 * pnpm --version died with SIGABRT). */
static int ep_shim_wait(int epfd, struct epoll_event *events, int maxevents,
			int timeout, epoll_pwait_fn real,
			const sigset_t *sigmask)
{
	int slice = ep_shim_clamp_timeout(epfd, timeout);
	if (slice == timeout)
		return ep_shim_after_wait(real(epfd, events, maxevents,
					       timeout, sigmask),
					  epfd, events, maxevents);

	long long deadline = 0;
	if (timeout > 0)
		deadline = ep_now_ms() + timeout;

	for (;;) {
		int rc = ep_shim_after_wait(real(epfd, events, maxevents,
						 slice, sigmask),
					    epfd, events, maxevents);
		if (rc != 0)
			return rc; /* real events, synthesized events, or -1/errno */
		if (timeout > 0) {
			long long left = deadline - ep_now_ms();
			if (left <= 0)
				return 0; /* caller's own timeout really expired */
			if (left < slice)
				slice = (int)left;
		}
	}
}

int epoll_wait(int epfd, struct epoll_event *events, int maxevents,
	       int timeout)
{
	/* Route through the real epoll_pwait with a NULL mask — that IS
	 * epoll_wait at the syscall level — so both overrides share the
	 * same hidden-slicing loop. */
	static epoll_pwait_fn real = NULL;
	if (!real)
		real = (epoll_pwait_fn)dlsym(RTLD_NEXT, "epoll_pwait");
	if (!real) {
		errno = ENOSYS;
		return -1;
	}
	return ep_shim_wait(epfd, events, maxevents, timeout, real, NULL);
}

int epoll_pwait(int epfd, struct epoll_event *events, int maxevents,
		int timeout, const sigset_t *sigmask)
{
	static epoll_pwait_fn real = NULL;
	if (!real)
		real = (epoll_pwait_fn)dlsym(RTLD_NEXT, "epoll_pwait");
	if (!real) {
		errno = ENOSYS;
		return -1;
	}
	return ep_shim_wait(epfd, events, maxevents, timeout, real, sigmask);
}

/* poll/ppoll: the real call already blocked for the full timeout, so all
 * that is left is correcting the lie -- FIFO fds that asked for POLLIN,
 * reported nothing, yet have bytes pending. No timeout clamping here. */
static int ep_shim_patch_pollfds(struct pollfd *fds, nfds_t nfds, int rc)
{
	nfds_t i;
	if (rc < 0 || !ep_pipe_active())
		return rc;
	for (i = 0; i < nfds; i++) {
		int avail = 0;
		if (fds[i].fd < 0 || !(fds[i].events & POLLIN) ||
		    fds[i].revents != 0)
			continue;
		if (!splice_fd_is_fifo(fds[i].fd))
			continue;
		if (ioctl(fds[i].fd, FIONREAD, &avail) == 0 && avail > 0) {
			fds[i].revents = POLLIN;
			rc++;	/* poll's rc counts fds with revents set */
		}
	}
	return rc;
}

typedef int (*poll_fn)(struct pollfd *, nfds_t, int);
typedef int (*ppoll_fn)(struct pollfd *, nfds_t, const struct timespec *,
			const sigset_t *);

int poll(struct pollfd *fds, nfds_t nfds, int timeout)
{
	static poll_fn real = NULL;
	if (!real)
		real = (poll_fn)dlsym(RTLD_NEXT, "poll");
	if (!real) {
		errno = ENOSYS;
		return -1;
	}
	return ep_shim_patch_pollfds(fds, nfds, real(fds, nfds, timeout));
}

int ppoll(struct pollfd *fds, nfds_t nfds, const struct timespec *timeout,
	  const sigset_t *sigmask)
{
	static ppoll_fn real = NULL;
	if (!real)
		real = (ppoll_fn)dlsym(RTLD_NEXT, "ppoll");
	if (!real) {
		errno = ENOSYS;
		return -1;
	}
	return ep_shim_patch_pollfds(fds, nfds,
				     real(fds, nfds, timeout, sigmask));
}

typedef int (*close_fn)(int);

int close(int fd)
{
	static close_fn real = NULL;
	if (!real)
		real = (close_fn)dlsym(RTLD_NEXT, "close");
	if (!real) {
		errno = ENOSYS;
		return -1;
	}
	/* Forget before the real close: afterwards the number can be
	 * handed out again at any moment. Covers the fd both as a
	 * registered pipe and as an epfd with pipes under repair. */
	if (fd >= 0 && ep_pipe_active()) {
		pthread_mutex_lock(&g_ep_pipes_lock);
		ep_reg_forget_fd_locked(fd);
		pthread_mutex_unlock(&g_ep_pipes_lock);
	}
	return real(fd);
}

int linkat(int olddirfd, const char *oldpath, int newdirfd,
	  const char *newpath, int flags)
{
	static linkat_fn real = NULL;
	if (!real)
		real = (linkat_fn)dlsym(RTLD_NEXT, "linkat");

	int rc = real ? real(olddirfd, oldpath, newdirfd, newpath, flags) : -1;
	if (rc == 0)
		return 0;
	if (shim_disabled("linkat"))
		return rc;
	if (errno != EPERM && errno != EACCES)
		return rc;

	int src = openat(olddirfd, oldpath,
			 O_RDONLY | (flags & AT_SYMLINK_FOLLOW ? 0 : O_NOFOLLOW));
	if (src < 0)
		return -1;

	struct stat st;
	if (fstat(src, &st) != 0) {
		int e = errno;
		close(src);
		errno = e;
		return -1;
	}

	if (copy_fd_to_path_atomic(src, newdirfd, newpath,
				   st.st_mode & 0777) != 0) {
		int e = errno;
		close(src);
		errno = e;
		return -1;
	}
	close(src);
	return 0;
}

typedef int (*symlinkat_fn)(const char *, int, const char *);

int symlinkat(const char *target, int newdirfd, const char *linkpath)
{
	static symlinkat_fn real = NULL;
	if (!real)
		real = (symlinkat_fn)dlsym(RTLD_NEXT, "symlinkat");

	int rc = real ? real(target, newdirfd, linkpath) : -1;
	if (rc == 0)
		return 0;
	if (shim_disabled("symlinkat"))
		return rc;
	if (errno != EPERM && errno != EACCES)
		return rc;

	/* Resolve `target` relative to the link's directory (newdirfd), NOT the
	 * process CWD: a package symlink's target is almost always a path
	 * relative to the link's own dir (e.g. node_modules/.bin/cli -> ../pkg),
	 * and resolving it against CWD would either miss or copy an unrelated
	 * same-named file. Only handles the "target resolves to a real file"
	 * case; a dangling/not-yet-extracted target still fails as before. */
	int src = openat(newdirfd, target, O_RDONLY);
	if (src < 0) {
		errno = EPERM;
		return -1;
	}

	struct stat st;
	if (fstat(src, &st) != 0) {
		int e = errno;
		close(src);
		errno = e;
		return -1;
	}

	if (copy_fd_to_path_atomic(src, newdirfd, linkpath,
				   st.st_mode & 0777) != 0) {
		int e = errno;
		close(src);
		errno = e;
		return -1;
	}
	close(src);
	return 0;
}

/* ==================================================================== */
/*  2b. getaddrinfo() — HarmonyOS's AI_ADDRCONFIG wrongly filters IPv4   */
/*     loopback: on a host with no global IPv4, "localhost" resolves to  */
/*     ::1 only, so Happy-Eyeballs callers (autoSelectFamily) have no    */
/*     IPv4 address to fall back to when ::1 refuses. When the real      */
/*     call with AI_ADDRCONFIG yields only IPv6-loopback results, redo   */
/*     the query without AI_ADDRCONFIG and append the AF_INET entries.   */
/*     (bun T49; verified against OHOS_TEST_STATUS.md's probe chain.)    */
/* ==================================================================== */

typedef int (*getaddrinfo_fn)(const char *, const char *,
			      const struct addrinfo *, struct addrinfo **);

/* glibc getaddrinfo rejects names with characters outside the DNS/hostname
 * alphabet locally (EAI_NONAME); HarmonyOS's resolver forwards them to the
 * network where they hang until timeout (~4s observed). That kills tests and
 * code that rely on a fast local reject (bun's udp_socket "bind fails" case
 * does it 200 times). Match glibc: fail fast, no network round-trip. */
static int hostname_has_invalid_chars(const char *node)
{
	for (const unsigned char *p = (const unsigned char *)node; *p; p++) {
		unsigned char c = *p;
		if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
		    (c >= '0' && c <= '9') || c == '.' || c == '-' ||
		    c == '_' || c == '%' || c == ':')
			continue;
		return 1;
	}
	return 0;
}

int getaddrinfo(const char *node, const char *service,
		const struct addrinfo *hints, struct addrinfo **res)
{
	static getaddrinfo_fn real = NULL;
	if (!real)
		real = (getaddrinfo_fn)dlsym(RTLD_NEXT, "getaddrinfo");
	if (!real) {
		errno = ENOSYS;
		return EAI_SYSTEM;
	}

	if (!shim_disabled("getaddrinfo") && node && *node &&
	    hostname_has_invalid_chars(node))
		return EAI_NONAME;

	int rc = real(node, service, hints, res);


	if (shim_disabled("getaddrinfo") || rc != 0 || !hints || !node ||
	    !(hints->ai_flags & AI_ADDRCONFIG))
		return rc;

	/* Only the broken case: every returned address is IPv6 loopback
	 * (and there is at least one). Anything else passes through. */
	int n = 0, all_v6_loopback = 1;
	struct addrinfo *tail = NULL;
	for (struct addrinfo *ai = *res; ai; ai = ai->ai_next) {
		n++;
		tail = ai;
		if (ai->ai_family != AF_INET6 ||
		    ai->ai_addrlen < sizeof(struct sockaddr_in6) ||
		    !IN6_IS_ADDR_LOOPBACK(
			    &((struct sockaddr_in6 *)ai->ai_addr)->sin6_addr)) {
			all_v6_loopback = 0;
			break;
		}
	}
	if (n == 0 || !all_v6_loopback) {
		return rc;
	}

	struct addrinfo hints2 = *hints;
	hints2.ai_flags &= ~AI_ADDRCONFIG;
	/* Force AF_INET for the retry: an AF_UNSPEC no-ADDRCONFIG query on this
	 * resolver can still come back v6-only (it is stateful), but an explicit
	 * AF_INET query for a loopback name is answered from /etc/hosts. */
	hints2.ai_family = AF_INET;
	struct addrinfo *res2 = NULL;
	if (real(node, service, &hints2, &res2) != 0) {
		return rc; /* retry failed: keep the original (broken) answer */
	}

	/* Move AF_INET nodes from res2 onto the tail of *res (preserving the
	 * loopback-first order), then free what remains of res2. */
	for (struct addrinfo **pp = &res2; *pp;) {
		struct addrinfo *ai = *pp;
		if (ai->ai_family == AF_INET) {
			*pp = ai->ai_next;   /* unlink from res2 */
			ai->ai_next = NULL;
			tail->ai_next = ai;  /* append to *res */
			tail = ai;
		} else {
			pp = &ai->ai_next;
		}
	}
	if (res2)
		freeaddrinfo(res2);
	return rc;
}