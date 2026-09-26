// Turns musl 1.2.5 (x86_64 and aarch64) into the libc of a portable image.
//
// The image keeps the Linux ABI. Every place where musl reaches the OS goes through `__bun_host`: on a
// Linux host it issues the real syscall, on any other host it calls into the native stub that loaded the
// image. The thread pointer is read through a register chosen at run time. No code is patched at load.
//
// One run patches both architectures: bun patch_musl.ts <musl dir>
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.argv[2];
if (!root) throw new Error("usage: bun patch_musl.ts <musl dir>");

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

function write(path: string, text: string) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** Replaces the first `old`, which has to be there. */
function replace(path: string, old: string, text: string) {
  const before = read(path);
  if (!before.includes(old)) throw new Error(`${path}: not found: ${old}`);
  write(
    path,
    before.replace(old, () => text),
  );
}

/** Keeps an assembly routine that issues syscalls as the Linux half of a dispatcher. */
function move_asm(old_path: string, new_path: string, old_name: string, new_name: string, hide = false) {
  let text = read(old_path);
  if (!text.includes(old_name)) throw new Error(`${old_path}: not found: ${old_name}`);
  text = text.split(old_name).join(new_name);
  if (hide && !text.includes(`.hidden ${new_name}`)) {
    text = text.replace(`.global ${new_name}\n`, () => `.global ${new_name}\n.hidden ${new_name}\n`);
    if (!text.includes(`.hidden ${new_name}`)) throw new Error(old_path);
  }
  rmSync(join(root, old_path));
  write(new_path, text);
}

/**
 * Threads that the image did not create: a thread of libuv's pool, of the pool of Windows, the thread
 * that Windows makes for a console control handler. musl knows the threads that pthread_create made.
 * Such a thread is adopted when it enters the image: it gets a thread structure of its own, and loses
 * it when it ends.
 */
function threads() {
  write(
    "src/thread/bun_adopt.c",
    `#define _GNU_SOURCE
#include <stddef.h>
#include <string.h>
#include <sys/mman.h>
#include "pthread_impl.h"
#include "stdio_impl.h"
#include "libc.h"
#include "lock.h"
#include "bun_host.h"

unsigned long __bun_tp_offset;

/* A thread of the list of threads, which is a ring without a head. */
hidden struct pthread *__bun_thread_anchor;

hidden void __bun_emutls_exit(void);
hidden void __bun_thread_leave(void *);

extern uintptr_t __stack_chk_guard;

static void dummy_0()
{
}
weak_alias(dummy_0, __pthread_tsd_run_dtors);
weak_alias(dummy_0, __do_orphaned_stdio_locks);
weak_alias(dummy_0, __dl_thread_cleanup);
weak_alias(dummy_0, __membarrier_init);

static volatile size_t dummy = 0;
weak_alias(dummy, __pthread_tsd_size);
static void *dummy_tsd[1] = { 0 };
weak_alias(dummy_tsd, __pthread_tsd_main);

static FILE *volatile dummy_file = 0;
weak_alias(dummy_file, __stdin_used);
weak_alias(dummy_file, __stdout_used);
weak_alias(dummy_file, __stderr_used);

static volatile int adopted_now, adopted_ever;

static void init_file_lock(FILE *f)
{
	if (f && f->lock<0) f->lock = 0;
}

#define ROUND(x) (((x)+PAGE_SIZE-1)&-PAGE_SIZE)

/* Called once, by the first thread, before the program runs. */
hidden void __bun_threads_init(void)
{
	struct pthread *self = __pthread_self();
	__bun_thread_anchor = self;
	if (__bun_host.os == BUN_OS_LINUX) {
#ifdef __x86_64__
		/* No thread of another maker exists on Linux. The check at an
		 * entry reads through gs there too, so gs gets a base, and
		 * what the check finds is not 0. A thread has the base of the
		 * thread that made it. */
		static unsigned long not_empty[1] = { 1 };
		__syscall(SYS_arch_prctl, 0x1001, not_empty);
#endif
		__bun_tp_offset = 0;
		return;
	}
	__bun_tp_offset = __bun_host.tcb_offset;

	/* What pthread_create does when it makes the second thread of a
	 * program. A thread of the host arrives without a call that the image
	 * makes, at any time, also while the only thread of the image is
	 * inside of a lock that a program with one thread does not take. So
	 * the image takes its locks from the start, and the threads of the
	 * host count as one thread that does not end. */
	for (FILE *f=*__ofl_lock(); f; f=f->next)
		init_file_lock(f);
	__ofl_unlock();
	init_file_lock(__stdin_used);
	init_file_lock(__stdout_used);
	init_file_lock(__stderr_used);
	__syscall(SYS_rt_sigprocmask, SIG_UNBLOCK, SIGPT_SET, 0, _NSIG/8);
	self->tsd = (void **)__pthread_tsd_main;
	__membarrier_init();
	libc.threaded = 1;
	libc.threads_minus_1 = 1;
	libc.need_locks = 1;
}

/* The calling thread has no thread pointer. Nothing here may read one before
 * the host has set it: no errno, no lock, no allocation of the C library. */
void __bun_thread_adopt(void)
{
	size_t size = ROUND(libc.tls_size + __pthread_tsd_size);
	unsigned char *map = (void *)__syscall(SYS_mmap, 0, size,
		PROT_READ|PROT_WRITE, MAP_PRIVATE|MAP_ANON, -1, 0);
	if ((unsigned long)map > -4096UL) a_crash();
	unsigned char *tsd = map + size - __pthread_tsd_size;
	struct pthread *td = __copy_tls(tsd - libc.tls_size);
	td->self = td;
	td->map_base = map;
	td->map_size = size;
	td->tsd = (void *)tsd;
	td->locale = &libc.global_locale;
	td->detach_state = DT_DETACHED;
	td->robust_list.head = &td->robust_list.head;
	td->canary = __stack_chk_guard;
	td->sysinfo = __sysinfo;
	td->tid = __syscall(SYS_gettid);
	td->next = td->prev = td;
	if (__syscall(BUN_SYS_adopt_thread, TP_ADJ(td), __bun_thread_leave) < 0)
		a_crash();

	/* The thread has a thread pointer now. */
	sigset_t set;
	__block_app_sigs(&set);
	__tl_lock();
	libc.threads_minus_1++;
	struct pthread *anchor = __bun_thread_anchor;
	td->next = anchor->next;
	td->prev = anchor;
	td->next->prev = td;
	td->prev->next = td;
	__tl_unlock();
	__restore_sigs(&set);
	a_inc(&adopted_now);
	a_inc(&adopted_ever);
}

/* The host calls this on an adopted thread that ends: what pthread_exit does
 * for a thread of the image, without the end of the thread, which is the
 * host's. The thread has its thread pointer until this returns. */
hidden void __bun_thread_leave(void *tp)
{
	struct pthread *self = __pthread_self();
	sigset_t set;

	self->canceldisable = 1;
	self->cancelasync = 0;
	__pthread_tsd_run_dtors();
	__bun_emutls_exit();

	__block_app_sigs(&set);
	LOCK(self->killlock);
	__tl_lock();
	self->tid = 0;
	UNLOCK(self->killlock);

	__vm_lock();
	volatile void *volatile *rp;
	while ((rp=self->robust_list.head) && rp != &self->robust_list.head) {
		pthread_mutex_t *m = (void *)((char *)rp
			- offsetof(pthread_mutex_t, _m_next));
		int waiters = m->_m_waiters;
		int priv = (m->_m_type & 128) ^ 128;
		self->robust_list.pending = rp;
		self->robust_list.head = *rp;
		int cont = a_swap(&m->_m_lock, 0x40000000);
		self->robust_list.pending = 0;
		if (cont < 0 || waiters)
			__wake(&m->_m_lock, 1, priv);
	}
	__vm_unlock();

	__do_orphaned_stdio_locks();
	__dl_thread_cleanup();

	libc.threads_minus_1--;
	if (__bun_thread_anchor == self) __bun_thread_anchor = self->next;
	self->next->prev = self->prev;
	self->prev->next = self->next;
	self->prev = self->next = self;
	__tl_unlock();
	__restore_sigs(&set);
	a_dec(&adopted_now);

	/* The structure is in the mapping: nothing of it is read after this. */
	__syscall(SYS_munmap, self->map_base, self->map_size);
}

unsigned long __bun_adopted_threads(unsigned long *ever)
{
	if (ever) *ever = adopted_ever;
	return adopted_now;
}
`,
  );

  replace(
    "src/env/__libc_start_main.c",
    `	__init_ssp((void *)aux[AT_RANDOM]);
`,
    `	__init_ssp((void *)aux[AT_RANDOM]);
	__bun_threads_init();
`,
  );
  replace(
    "src/env/__libc_start_main.c",
    `static void dummy(void) {}`,
    `hidden void __bun_threads_init(void);

static void dummy(void) {}`,
  );

  // A thread that ends is no longer the way into the list of threads.
  replace(
    "src/thread/pthread_create.c",
    `	if (!--libc.threads_minus_1) libc.need_locks = -1;
	self->next->prev = self->prev;
`,
    `	if (!--libc.threads_minus_1) libc.need_locks = -1;
	if (__bun_thread_anchor == self) __bun_thread_anchor = self->next;
	self->next->prev = self->prev;
`,
  );
  replace(
    "src/thread/pthread_create.c",
    `hidden void __bun_emutls_exit(void);
`,
    `hidden void __bun_emutls_exit(void);
hidden extern struct pthread *__bun_thread_anchor;
`,
  );
}

const ARGS = ["a1", "a2", "a3", "a4", "a5", "a6"];

const CLONE_C = `#include <stdarg.h>
#include "pthread_impl.h"
#include "bun_host.h"

hidden int __clone_linux(int (*)(void *), void *, int, void *, int *, void *, int *);

int __clone(int (*fn)(void *), void *stack, int flags, void *arg, ...)
{
	va_list ap;
	va_start(ap, arg);
	int *ptid = va_arg(ap, int *);
	void *tls = va_arg(ap, void *);
	int *ctid = va_arg(ap, int *);
	va_end(ap);
	if (__bun_host.os == BUN_OS_LINUX)
		return __clone_linux(fn, stack, flags, arg, ptid, tls, ctid);
	return __bun_host.thread_create(fn, stack, flags, arg, ptid, tls, ctid);
}
`;

const UNMAPSELF_C = `#include "pthread_impl.h"
#include "bun_host.h"

hidden _Noreturn void __unmapself_linux(void *, size_t);

_Noreturn void __unmapself(void *base, size_t size)
{
	if (__bun_host.os == BUN_OS_LINUX) __unmapself_linux(base, size);
	__bun_host.thread_exit(base, size);
	for (;;);
}
`;

function common() {
  // One header for every architecture. It sits in src/internal, which is on
  // the include path of all of them.
  write(
    "src/internal/bun_host.h",
    `#ifndef BUN_HOST_H
#define BUN_HOST_H

#define BUN_OS_LINUX 1
#define BUN_OS_WINDOWS 2
#define BUN_OS_MACOS 3
#define AT_BUN_HOST 0x62756e00
/* How many entries of struct bun_host the host filled. A host that does not
   say has the first five. */
#define AT_BUN_HOST_ENTRIES 0x62756e10
#define BUN_HOST_ENTRIES_MIN 5

/* A request to the host that is not a Linux syscall. It goes through
   __bun_host.syscall with a number that Linux does not use.
   BUN_SYS_set_tp(tp): make tp the thread pointer of the calling thread.
   aarch64 needs it because Linux has no syscall for that there (a program
   writes tpidr_el0 itself). x86_64 keeps using arch_prctl(ARCH_SET_FS). */
#define BUN_SYS_set_tp 0x62756e01
/* BUN_SYS_adopt_thread(tp, leave): the calling thread is one that the host or
   its OS created, and it entered the image. Make tp its thread pointer, and
   when the thread ends call leave(tp) on it, with the calling convention of
   the image. A host that does not know the request answers -ENOSYS. */
#define BUN_SYS_adopt_thread 0x62756e02

struct bun_host {
	unsigned long os;
	unsigned long tcb_offset;
	long (*syscall)(long, long, long, long, long, long, long);
	long (*thread_create)(int (*)(void *), void *, long, void *, int *, void *, int *);
	void (*thread_exit)(void *, unsigned long);
	/* The address of a function of the host OS, 0 if the library or the
	   symbol is not there. The Windows host: LoadLibraryW and
	   GetProcAddress, and the libuv that is linked into the host for the
	   library "libuv". The function has the calling convention of the host
	   OS, not the one of the image. */
	void *(*lookup)(const char *library, const char *symbol);
	/* The OS that runs the host, when os does not say it: the test host on
	   Linux reaches the kernel the way another host does. 0: the same as os. */
	unsigned long native_os;
};

extern struct bun_host __bun_host __attribute__((__visibility__("hidden")));

/* For the program in the image. */
unsigned long __bun_host_os(void);
void *__bun_host_lookup(const char *library, const char *symbol);

/* Threads that the image did not create (bun_adopt.c). Code that the host
   or its OS calls on a thread of theirs checks the slot of the thread
   pointer first, and adopts the thread when the slot is empty:
       if (!*(void **)(thread register + __bun_tp_offset)) __bun_thread_adopt();
   On x86-64 the thread register of the check is gs on every host. */
extern unsigned long __bun_tp_offset;
void __bun_thread_adopt(void);
/* How many adopted threads there are now, and how many there were. */
unsigned long __bun_adopted_threads(unsigned long *ever);

#endif
`,
  );

  write(
    "src/internal/bun_host.c",
    `#include "bun_host.h"

struct bun_host __bun_host = { BUN_OS_LINUX, 0, 0, 0, 0, 0, 0 };

unsigned long __bun_host_os(void)
{
	return __bun_host.native_os ? __bun_host.native_os : __bun_host.os;
}

void *__bun_host_lookup(const char *library, const char *symbol)
{
	if (__bun_host.os == BUN_OS_LINUX || !__bun_host.lookup) return 0;
	return __bun_host.lookup(library, symbol);
}
`,
  );

  replace(
    "src/env/__libc_start_main.c",
    `	libc.auxv = auxv = (void *)(envp+i+1);
`,
    `	libc.auxv = auxv = (void *)(envp+i+1);
	{
		size_t *table = 0, entries = BUN_HOST_ENTRIES_MIN;
		for (i=0; auxv[i]; i+=2) {
			if (auxv[i]==AT_BUN_HOST) table = (void *)auxv[i+1];
			if (auxv[i]==AT_BUN_HOST_ENTRIES) entries = auxv[i+1];
		}
		if (entries > sizeof __bun_host / sizeof(size_t)) entries = sizeof __bun_host / sizeof(size_t);
		if (table) memcpy(&__bun_host, table, entries * sizeof(size_t));
	}
`,
  );
  replace(
    "src/env/__libc_start_main.c",
    '#include "libc.h"',
    '#include "libc.h"\n#include <string.h>\n#include "bun_host.h"',
  );

  // Cancellable syscalls: the assembly (__syscall_cp_asm, it issues the
  // syscall itself on every architecture) is used on a Linux host only.
  replace(
    "src/thread/pthread_cancel.c",
    `	pthread_t self;
	long r;
	int st;
`,
    `	pthread_t self;
	long r;
	int st;

	if (__bun_host.os != BUN_OS_LINUX) return __syscall(nr, u, v, w, x, y, z);
`,
  );
  replace(
    "src/thread/pthread_cancel.c",
    '#include "pthread_impl.h"',
    '#include "pthread_impl.h"\n#include "bun_host.h"',
  );

  // The new field is in part 2 of struct pthread. With TLS_ABOVE_TP (aarch64)
  // part 3 stays at the end, so tp - 16 (canary) and tp - 8 (dtv) do not move.
  replace(
    "src/internal/pthread_impl.h",
    `	void *stdio_locks;
`,
    `	void *stdio_locks;
	void *bun_emutls;
`,
  );

  write(
    "src/thread/bun_emutls.c",
    `#include <stdlib.h>
#include <string.h>
#include "pthread_impl.h"
#include "lock.h"

struct emutls_control { size_t size, align; uintptr_t index; void *value; };
struct emutls_array { size_t count; void *slots[]; };

static volatile int emutls_lock[1];
static uintptr_t emutls_next;

static void *emutls_slow(struct emutls_control *c)
{
	pthread_t self = __pthread_self();
	LOCK(emutls_lock);
	if (!c->index) c->index = ++emutls_next;
	UNLOCK(emutls_lock);
	uintptr_t i = c->index;
	struct emutls_array *a = self->bun_emutls;
	if (!a || a->count < i) {
		size_t n = i + 16;
		struct emutls_array *b = calloc(1, sizeof *b + n * sizeof(void *));
		if (!b) abort();
		if (a) memcpy(b->slots, a->slots, a->count * sizeof(void *));
		b->count = n;
		free(a);
		self->bun_emutls = a = b;
	}
	size_t align = c->align < sizeof(void *) ? sizeof(void *) : c->align;
	void *p = aligned_alloc(align, (c->size + align - 1) & -align);
	if (!p) abort();
	if (c->value) memcpy(p, c->value, c->size);
	else memset(p, 0, c->size);
	a->slots[i - 1] = p;
	return p;
}

void *__emutls_get_address(struct emutls_control *c)
{
	struct emutls_array *a = __pthread_self()->bun_emutls;
	uintptr_t i = c->index;
	if (__builtin_expect(a && i && i <= a->count && a->slots[i - 1], 1)) return a->slots[i - 1];
	return emutls_slow(c);
}

hidden void __bun_emutls_exit(void)
{
	struct emutls_array *a = __pthread_self()->bun_emutls;
	if (!a) return;
	for (size_t i = 0; i < a->count; i++) free(a->slots[i]);
	free(a);
	__pthread_self()->bun_emutls = 0;
}
`,
  );

  replace(
    "src/thread/pthread_create.c",
    `	__pthread_tsd_run_dtors();
`,
    `	__pthread_tsd_run_dtors();
	__bun_emutls_exit();
`,
  );
  replace(
    "src/thread/pthread_create.c",
    `static void dummy_0()
`,
    `hidden void __bun_emutls_exit(void);

static void dummy_0()
`,
  );

  threads();

  // Signal return trampoline, see aarch64(). Only an architecture that
  // defines BUN_HOST_RESTORER is affected: x86_64 does not, its code is the
  // same as before.
  replace(
    "src/signal/sigaction.c",
    `		ksa.restorer = (sa->sa_flags & SA_SIGINFO) ? __restore_rt : __restore;
`,
    `		ksa.restorer = (sa->sa_flags & SA_SIGINFO) ? __restore_rt : __restore;
#ifdef BUN_HOST_RESTORER
		if (__bun_host.os != BUN_OS_LINUX) ksa.restorer = BUN_HOST_RESTORER;
#endif
`,
  );
}

function x86_64() {
  const regs = ['"D"(a1)', '"S"(a2)', '"d"(a3)', '"r"(r10)', '"r"(r8)', '"r"(r9)'];
  const out = ['#include "bun_host.h"\n\n#define __SYSCALL_LL_E(x) (x)\n#define __SYSCALL_LL_O(x) (x)\n'];
  for (let n = 0; n < 7; n++) {
    const params = ARGS.slice(0, n)
      .map(a => `, long ${a}`)
      .join("");
    const host_args = [...ARGS.slice(0, n), ...Array(6 - n).fill("0")].join(", ");
    let decl = "";
    if (n >= 4) decl += '\tregister long r10 __asm__("r10") = a4;\n';
    if (n >= 5) decl += '\tregister long r8 __asm__("r8") = a5;\n';
    if (n >= 6) decl += '\tregister long r9 __asm__("r9") = a6;\n';
    const inputs = ['"a"(n)', ...regs.slice(0, n)].join(", ");
    out.push(`
static __inline long __syscall${n}(long n${params})
{
	unsigned long ret;
	if (__builtin_expect(__bun_host.os != BUN_OS_LINUX, 0))
		return __bun_host.syscall(n, ${host_args});
${decl}	__asm__ __volatile__ ("syscall" : "=a"(ret) : ${inputs} : "rcx", "r11", "memory");
	return ret;
}
`);
  }
  let tail = read("arch/x86_64/syscall_arch.h");
  tail = tail.slice(tail.indexOf("#define VDSO_USEFUL"));
  write("arch/x86_64/syscall_arch.h", out.join("") + "\n" + tail);

  replace(
    "arch/x86_64/pthread_arch.h",
    `static inline uintptr_t __get_tp()
{
	uintptr_t tp;
	__asm__ ("mov %%fs:0,%0" : "=r" (tp) );
	return tp;
}`,
    `#include "bun_host.h"

static inline uintptr_t __get_tp()
{
	uintptr_t tp, off = __bun_host.tcb_offset;
	if (__builtin_expect(__bun_host.os == BUN_OS_LINUX, 1))
		__asm__ ("mov %%fs:(%1),%0" : "=r" (tp) : "r" (off) );
	else
		__asm__ ("mov %%gs:(%1),%0" : "=r" (tp) : "r" (off) );
	return tp;
}`,
  );

  rmSync(join(root, "src/thread/x86_64/__set_thread_area.s"));
  write(
    "src/thread/x86_64/__set_thread_area.c",
    `#include "pthread_impl.h"
#include "syscall.h"

int __set_thread_area(void *p)
{
	return __syscall(SYS_arch_prctl, 0x1002, p);
}
`,
  );

  move_asm("src/thread/x86_64/clone.s", "src/thread/x86_64/clone_linux.s", "__clone", "__clone_linux");
  write("src/thread/x86_64/clone.c", CLONE_C);
  move_asm(
    "src/thread/x86_64/__unmapself.s",
    "src/thread/x86_64/unmapself_linux.s",
    "__unmapself",
    "__unmapself_linux",
  );
  write("src/thread/x86_64/__unmapself.c", UNMAPSELF_C);
}

function aarch64() {
  // Every "svc" of the aarch64 tree and what guards it:
  //   arch/aarch64/syscall_arch.h        branch on __bun_host.os, below
  //   src/thread/aarch64/clone.s         now __clone_linux, called by clone.c on Linux only
  //   src/thread/aarch64/__unmapself.s   now __unmapself_linux, called by __unmapself.c on Linux only
  //   src/thread/aarch64/syscall_cp.s    __syscall_cp_c returns before it on other hosts (common())
  //   src/process/aarch64/vfork.s        now __vfork_linux, called by vfork.c on Linux only
  //   src/signal/aarch64/restore.s       unchanged. It is entered only through a signal frame that
  //                                      the Linux kernel built. Other hosts get __bun_restore_host.
  // and every use of the thread pointer register:
  //   src/thread/aarch64/__set_thread_area.s   now C, writes tpidr_el0 on Linux only
  //   arch/aarch64/pthread_arch.h              __get_tp(), below
  //   src/ldso/aarch64/tlsdesc.s               dynamic linker only, not part of a static image
  const out = ['#include "bun_host.h"\n\n#define __SYSCALL_LL_E(x) (x)\n#define __SYSCALL_LL_O(x) (x)\n'];
  for (let n = 0; n < 7; n++) {
    const params = ARGS.slice(0, n)
      .map(a => `, long ${a}`)
      .join("");
    const host_args = [...ARGS.slice(0, n), ...Array(6 - n).fill("0")].join(", ");
    let decl = '\tregister long x8 __asm__("x8") = n;\n';
    decl += '\tregister long x0 __asm__("x0")' + (n ? " = a1" : "") + ";\n";
    for (let i = 1; i < n; i++) decl += `\tregister long x${i} __asm__("x${i}") = a${i + 1};\n`;
    const inputs = [
      '"r"(x8)',
      ...(n ? ['"0"(x0)'] : []),
      ...Array.from({ length: Math.max(n - 1, 0) }, (_, k) => `"r"(x${k + 1})`),
    ].join(", ");
    out.push(`
static __inline long __syscall${n}(long n${params})
{
	if (__builtin_expect(__bun_host.os != BUN_OS_LINUX, 0))
		return __bun_host.syscall(n, ${host_args});
${decl}	__asm__ __volatile__ ("svc 0" : "=r"(x0) : ${inputs} : "memory", "cc");
	return x0;
}
`);
  }
  let tail = read("arch/aarch64/syscall_arch.h");
  tail = tail.slice(tail.indexOf("#define VDSO_USEFUL"));
  write(
    "arch/aarch64/syscall_arch.h",
    out.join("") +
      "\n" +
      tail +
      `
hidden void __bun_restore_host(void);
#define BUN_HOST_RESTORER __bun_restore_host
`,
  );

  // TLS_ABOVE_TP: the thread pointer is the END of struct pthread, and
  // __pthread_self() is __get_tp() - sizeof(struct pthread). That stays as it
  // is: the host stores the value that musl hands to __set_thread_area and
  // __clone (TP_ADJ(td)), and __get_tp() returns that same value.
  replace(
    "arch/aarch64/pthread_arch.h",
    `static inline uintptr_t __get_tp()
{
	uintptr_t tp;
	__asm__ ("mrs %0,tpidr_el0" : "=r"(tp));
	return tp;
}`,
    `#include "bun_host.h"

static inline uintptr_t __get_tp()
{
	uintptr_t tp;
	if (__builtin_expect(__bun_host.os == BUN_OS_LINUX, 1)) {
		__asm__ ("mrs %0,tpidr_el0" : "=r"(tp));
		return tp;
	}
	if (__bun_host.os == BUN_OS_WINDOWS) {
		/* x18 is the TEB. The image is built with -ffixed-x18. */
		__asm__ ("mov %0,x18" : "=r"(tp));
	} else {
		/* macOS 11 keeps the cpu number in the low 3 bits of tpidrro_el0. */
		__asm__ ("mrs %0,tpidrro_el0" : "=r"(tp));
		tp &= -8UL;
	}
	return *(uintptr_t *)(tp + __bun_host.tcb_offset);
}`,
  );

  // (__bun_host.syscall)(...) in parentheses: syscall.h makes "syscall(" a macro.
  rmSync(join(root, "src/thread/aarch64/__set_thread_area.s"));
  write(
    "src/thread/aarch64/__set_thread_area.c",
    `#include "pthread_impl.h"
#include "syscall.h"

int __set_thread_area(void *p)
{
	if (__bun_host.os != BUN_OS_LINUX)
		return (__bun_host.syscall)(BUN_SYS_set_tp, (long)p, 0, 0, 0, 0, 0);
	__asm__ __volatile__ ("msr tpidr_el0,%0" : : "r"(p));
	return 0;
}
`,
  );

  move_asm("src/thread/aarch64/clone.s", "src/thread/aarch64/clone_linux.s", "__clone", "__clone_linux");
  write("src/thread/aarch64/clone.c", CLONE_C);
  move_asm(
    "src/thread/aarch64/__unmapself.s",
    "src/thread/aarch64/unmapself_linux.s",
    "__unmapself",
    "__unmapself_linux",
    true,
  );
  write("src/thread/aarch64/__unmapself.c", UNMAPSELF_C);

  // vfork: the child runs on the parent's stack and returns from vfork()
  // before the parent does, so the Linux path must not leave a frame of this
  // function behind. musttail makes the compiler guarantee that. Other hosts
  // get the request that musl's generic vfork() makes: fork.
  move_asm("src/process/aarch64/vfork.s", "src/process/aarch64/vfork_linux.s", "vfork", "__vfork_linux", true);
  write(
    "src/process/aarch64/vfork.c",
    `#define _GNU_SOURCE
#include <unistd.h>
#include <signal.h>
#include "syscall.h"

hidden pid_t __vfork_linux(void);

pid_t vfork(void)
{
	if (__bun_host.os == BUN_OS_LINUX)
		__attribute__((musttail)) return __vfork_linux();
	return __syscall_ret((__bun_host.syscall)(SYS_clone, SIGCHLD, 0, 0, 0, 0, 0));
}
`,
  );

  // Signal return. restore.s stays the two instructions that the kernel,
  // debuggers and unwinders know ("mov x8,#139; svc 0"): a dispatcher in
  // front of them would break unwinding through signal frames on Linux, and
  // sigreturn needs sp exactly as the handler left it. The choice is made in
  // sigaction() instead: a host that is not Linux is handed this function.
  write(
    "src/signal/aarch64/bun_restore.c",
    `#include "syscall.h"

hidden void __bun_restore_host(void)
{
	(__bun_host.syscall)(SYS_rt_sigreturn, 0, 0, 0, 0, 0, 0);
	for (;;);
}
`,
  );
}

common();
x86_64();
aarch64();
console.log("patched", root);
