#!/usr/bin/env python3
"""Turn musl 1.2.5 (x86_64 and aarch64) into the libc of a portable image.

The image keeps the Linux ABI. Every place where musl reaches the OS goes
through `__bun_host`: on a Linux host it issues the real syscall, on any other
host it calls into the native stub that loaded the image. The thread pointer is
read through a register chosen at run time. No code is patched at load.

One run patches both architectures: patch_musl.py <musl dir>
"""
import os
import sys

root = sys.argv[1]


def read(path):
    return open(os.path.join(root, path)).read()


def write(path, text):
    full = os.path.join(root, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, "w").write(text)


def replace(path, old, new, count=1):
    text = read(path)
    assert text.count(old) >= 1, (path, old)
    write(path, text.replace(old, new, count))


def move_asm(old_path, new_path, old_name, new_name, hide=False):
    """Keep an assembly routine that issues syscalls as the Linux half of a dispatcher."""
    text = read(old_path)
    assert old_name in text, (old_path, old_name)
    text = text.replace(old_name, new_name)
    if hide and f".hidden {new_name}" not in text:
        text = text.replace(f".global {new_name}\n", f".global {new_name}\n.hidden {new_name}\n", 1)
        assert f".hidden {new_name}" in text, old_path
    os.remove(os.path.join(root, old_path))
    write(new_path, text)


ARGS = ["a1", "a2", "a3", "a4", "a5", "a6"]

CLONE_C = """#include <stdarg.h>
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
"""

UNMAPSELF_C = """#include "pthread_impl.h"
#include "bun_host.h"

hidden _Noreturn void __unmapself_linux(void *, size_t);

_Noreturn void __unmapself(void *base, size_t size)
{
	if (__bun_host.os == BUN_OS_LINUX) __unmapself_linux(base, size);
	__bun_host.thread_exit(base, size);
	for (;;);
}
"""


def common():
    # One header for every architecture. It sits in src/internal, which is on
    # the include path of all of them.
    write("src/internal/bun_host.h", """#ifndef BUN_HOST_H
#define BUN_HOST_H

#define BUN_OS_LINUX 1
#define BUN_OS_WINDOWS 2
#define BUN_OS_MACOS 3
#define AT_BUN_HOST 0x62756e00

/* A request to the host that is not a Linux syscall. It goes through
   __bun_host.syscall with a number that Linux does not use.
   BUN_SYS_set_tp(tp): make tp the thread pointer of the calling thread.
   aarch64 needs it because Linux has no syscall for that there (a program
   writes tpidr_el0 itself). x86_64 keeps using arch_prctl(ARCH_SET_FS). */
#define BUN_SYS_set_tp 0x62756e01

struct bun_host {
	unsigned long os;
	unsigned long tcb_offset;
	long (*syscall)(long, long, long, long, long, long, long);
	long (*thread_create)(int (*)(void *), void *, long, void *, int *, void *, int *);
	void (*thread_exit)(void *, unsigned long);
};

extern struct bun_host __bun_host __attribute__((__visibility__("hidden")));

#endif
""")

    write("src/internal/bun_host.c", """#include "bun_host.h"

struct bun_host __bun_host = { BUN_OS_LINUX, 0, 0, 0, 0 };
""")

    replace("src/env/__libc_start_main.c", """	libc.auxv = auxv = (void *)(envp+i+1);
""", """	libc.auxv = auxv = (void *)(envp+i+1);
	for (i=0; auxv[i]; i+=2) if (auxv[i]==AT_BUN_HOST) __bun_host = *(struct bun_host *)auxv[i+1];
""")
    replace("src/env/__libc_start_main.c", '#include "libc.h"', '#include "libc.h"\n#include "bun_host.h"')

    # Cancellable syscalls: the assembly (__syscall_cp_asm, it issues the
    # syscall itself on every architecture) is used on a Linux host only.
    replace("src/thread/pthread_cancel.c", """	pthread_t self;
	long r;
	int st;
""", """	pthread_t self;
	long r;
	int st;

	if (__bun_host.os != BUN_OS_LINUX) return __syscall(nr, u, v, w, x, y, z);
""")
    replace("src/thread/pthread_cancel.c", '#include "pthread_impl.h"', '#include "pthread_impl.h"\n#include "bun_host.h"')

    # The new field is in part 2 of struct pthread. With TLS_ABOVE_TP (aarch64)
    # part 3 stays at the end, so tp - 16 (canary) and tp - 8 (dtv) do not move.
    replace("src/internal/pthread_impl.h", """	void *stdio_locks;
""", """	void *stdio_locks;
	void *bun_emutls;
""")

    write("src/thread/bun_emutls.c", """#include <stdlib.h>
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
""")

    replace("src/thread/pthread_create.c", """	__pthread_tsd_run_dtors();
""", """	__pthread_tsd_run_dtors();
	__bun_emutls_exit();
""")
    replace("src/thread/pthread_create.c", """static void dummy_0()
""", """hidden void __bun_emutls_exit(void);

static void dummy_0()
""")

    # Signal return trampoline, see aarch64(). Only an architecture that
    # defines BUN_HOST_RESTORER is affected: x86_64 does not, its code is the
    # same as before.
    replace("src/signal/sigaction.c", """		ksa.restorer = (sa->sa_flags & SA_SIGINFO) ? __restore_rt : __restore;
""", """		ksa.restorer = (sa->sa_flags & SA_SIGINFO) ? __restore_rt : __restore;
#ifdef BUN_HOST_RESTORER
		if (__bun_host.os != BUN_OS_LINUX) ksa.restorer = BUN_HOST_RESTORER;
#endif
""")


def x86_64():
    regs = ['"D"(a1)', '"S"(a2)', '"d"(a3)', '"r"(r10)', '"r"(r8)', '"r"(r9)']
    out = ['#include "bun_host.h"\n\n#define __SYSCALL_LL_E(x) (x)\n#define __SYSCALL_LL_O(x) (x)\n']
    for n in range(7):
        params = "".join(f", long {a}" for a in ARGS[:n])
        host_args = ", ".join(ARGS[:n] + ["0"] * (6 - n))
        decl = ""
        if n >= 4:
            decl += '\tregister long r10 __asm__("r10") = a4;\n'
        if n >= 5:
            decl += '\tregister long r8 __asm__("r8") = a5;\n'
        if n >= 6:
            decl += '\tregister long r9 __asm__("r9") = a6;\n'
        inputs = ", ".join(['"a"(n)'] + regs[:n])
        out.append(f"""
static __inline long __syscall{n}(long n{params})
{{
	unsigned long ret;
	if (__builtin_expect(__bun_host.os != BUN_OS_LINUX, 0))
		return __bun_host.syscall(n, {host_args});
{decl}	__asm__ __volatile__ ("syscall" : "=a"(ret) : {inputs} : "rcx", "r11", "memory");
	return ret;
}}
""")
    tail = read("arch/x86_64/syscall_arch.h")
    tail = tail[tail.index("#define VDSO_USEFUL"):]
    write("arch/x86_64/syscall_arch.h", "".join(out) + "\n" + tail)

    replace("arch/x86_64/pthread_arch.h", """static inline uintptr_t __get_tp()
{
	uintptr_t tp;
	__asm__ ("mov %%fs:0,%0" : "=r" (tp) );
	return tp;
}""", """#include "bun_host.h"

static inline uintptr_t __get_tp()
{
	uintptr_t tp, off = __bun_host.tcb_offset;
	if (__builtin_expect(__bun_host.os == BUN_OS_LINUX, 1))
		__asm__ ("mov %%fs:(%1),%0" : "=r" (tp) : "r" (off) );
	else
		__asm__ ("mov %%gs:(%1),%0" : "=r" (tp) : "r" (off) );
	return tp;
}""")

    os.remove(os.path.join(root, "src/thread/x86_64/__set_thread_area.s"))
    write("src/thread/x86_64/__set_thread_area.c", """#include "pthread_impl.h"
#include "syscall.h"

int __set_thread_area(void *p)
{
	return __syscall(SYS_arch_prctl, 0x1002, p);
}
""")

    move_asm("src/thread/x86_64/clone.s", "src/thread/x86_64/clone_linux.s", "__clone", "__clone_linux")
    write("src/thread/x86_64/clone.c", CLONE_C)
    move_asm("src/thread/x86_64/__unmapself.s", "src/thread/x86_64/unmapself_linux.s", "__unmapself", "__unmapself_linux")
    write("src/thread/x86_64/__unmapself.c", UNMAPSELF_C)


def aarch64():
    # Every "svc" of the aarch64 tree and what guards it:
    #   arch/aarch64/syscall_arch.h        branch on __bun_host.os, below
    #   src/thread/aarch64/clone.s         now __clone_linux, called by clone.c on Linux only
    #   src/thread/aarch64/__unmapself.s   now __unmapself_linux, called by __unmapself.c on Linux only
    #   src/thread/aarch64/syscall_cp.s    __syscall_cp_c returns before it on other hosts (common())
    #   src/process/aarch64/vfork.s        now __vfork_linux, called by vfork.c on Linux only
    #   src/signal/aarch64/restore.s       unchanged. It is entered only through a signal frame that
    #                                      the Linux kernel built. Other hosts get __bun_restore_host.
    # and every use of the thread pointer register:
    #   src/thread/aarch64/__set_thread_area.s   now C, writes tpidr_el0 on Linux only
    #   arch/aarch64/pthread_arch.h              __get_tp(), below
    #   src/ldso/aarch64/tlsdesc.s               dynamic linker only, not part of a static image
    out = ['#include "bun_host.h"\n\n#define __SYSCALL_LL_E(x) (x)\n#define __SYSCALL_LL_O(x) (x)\n']
    for n in range(7):
        params = "".join(f", long {a}" for a in ARGS[:n])
        host_args = ", ".join(ARGS[:n] + ["0"] * (6 - n))
        decl = '\tregister long x8 __asm__("x8") = n;\n'
        decl += '\tregister long x0 __asm__("x0")' + (" = a1" if n else "") + ";\n"
        for i in range(1, n):
            decl += f'\tregister long x{i} __asm__("x{i}") = a{i + 1};\n'
        inputs = ", ".join(['"r"(x8)'] + (['"0"(x0)'] if n else []) + [f'"r"(x{i})' for i in range(1, n)])
        out.append(f"""
static __inline long __syscall{n}(long n{params})
{{
	if (__builtin_expect(__bun_host.os != BUN_OS_LINUX, 0))
		return __bun_host.syscall(n, {host_args});
{decl}	__asm__ __volatile__ ("svc 0" : "=r"(x0) : {inputs} : "memory", "cc");
	return x0;
}}
""")
    tail = read("arch/aarch64/syscall_arch.h")
    tail = tail[tail.index("#define VDSO_USEFUL"):]
    write("arch/aarch64/syscall_arch.h", "".join(out) + "\n" + tail + """
hidden void __bun_restore_host(void);
#define BUN_HOST_RESTORER __bun_restore_host
""")

    # TLS_ABOVE_TP: the thread pointer is the END of struct pthread, and
    # __pthread_self() is __get_tp() - sizeof(struct pthread). That stays as it
    # is: the host stores the value that musl hands to __set_thread_area and
    # __clone (TP_ADJ(td)), and __get_tp() returns that same value.
    replace("arch/aarch64/pthread_arch.h", """static inline uintptr_t __get_tp()
{
	uintptr_t tp;
	__asm__ ("mrs %0,tpidr_el0" : "=r"(tp));
	return tp;
}""", """#include "bun_host.h"

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
}""")

    # (__bun_host.syscall)(...) in parentheses: syscall.h makes "syscall(" a macro.
    os.remove(os.path.join(root, "src/thread/aarch64/__set_thread_area.s"))
    write("src/thread/aarch64/__set_thread_area.c", """#include "pthread_impl.h"
#include "syscall.h"

int __set_thread_area(void *p)
{
	if (__bun_host.os != BUN_OS_LINUX)
		return (__bun_host.syscall)(BUN_SYS_set_tp, (long)p, 0, 0, 0, 0, 0);
	__asm__ __volatile__ ("msr tpidr_el0,%0" : : "r"(p));
	return 0;
}
""")

    move_asm("src/thread/aarch64/clone.s", "src/thread/aarch64/clone_linux.s", "__clone", "__clone_linux")
    write("src/thread/aarch64/clone.c", CLONE_C)
    move_asm("src/thread/aarch64/__unmapself.s", "src/thread/aarch64/unmapself_linux.s", "__unmapself", "__unmapself_linux", hide=True)
    write("src/thread/aarch64/__unmapself.c", UNMAPSELF_C)

    # vfork: the child runs on the parent's stack and returns from vfork()
    # before the parent does, so the Linux path must not leave a frame of this
    # function behind. musttail makes the compiler guarantee that. Other hosts
    # get the request that musl's generic vfork() makes: fork.
    move_asm("src/process/aarch64/vfork.s", "src/process/aarch64/vfork_linux.s", "vfork", "__vfork_linux", hide=True)
    write("src/process/aarch64/vfork.c", """#define _GNU_SOURCE
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
""")

    # Signal return. restore.s stays the two instructions that the kernel,
    # debuggers and unwinders know ("mov x8,#139; svc 0"): a dispatcher in
    # front of them would break unwinding through signal frames on Linux, and
    # sigreturn needs sp exactly as the handler left it. The choice is made in
    # sigaction() instead: a host that is not Linux is handed this function.
    write("src/signal/aarch64/bun_restore.c", """#include "syscall.h"

hidden void __bun_restore_host(void)
{
	(__bun_host.syscall)(SYS_rt_sigreturn, 0, 0, 0, 0, 0, 0);
	for (;;);
}
""")


common()
x86_64()
aarch64()
print("patched", root)
