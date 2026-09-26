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
/* BUN_SYS_main_stack(unsigned long bounds[2]): the stack that the host made
   for the main thread. bounds[0] is its lowest address, bounds[1] the address
   after its highest. musl finds these on Linux by probing with mremap
   (pthread_getattr_np), which means nothing anywhere else. */
#define BUN_SYS_main_stack 0x62756e02

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

#endif
""")

    write("src/internal/bun_host.c", """#include "bun_host.h"

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
""")

    replace("src/env/__libc_start_main.c", """	libc.auxv = auxv = (void *)(envp+i+1);
""", """	libc.auxv = auxv = (void *)(envp+i+1);
	{
		size_t *table = 0, entries = BUN_HOST_ENTRIES_MIN;
		for (i=0; auxv[i]; i+=2) {
			if (auxv[i]==AT_BUN_HOST) table = (void *)auxv[i+1];
			if (auxv[i]==AT_BUN_HOST_ENTRIES) entries = auxv[i+1];
		}
		if (entries > sizeof __bun_host / sizeof(size_t)) entries = sizeof __bun_host / sizeof(size_t);
		if (table) memcpy(&__bun_host, table, entries * sizeof(size_t));
	}
""")
    replace("src/env/__libc_start_main.c", '#include "libc.h"', '#include "libc.h"\n#include <string.h>\n#include "bun_host.h"')

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

    # The allocator that musl keeps for itself gets names of its own. An image
    # may bring its own malloc, and mimalloc defines __libc_malloc,
    # __libc_calloc, __libc_realloc and __libc_free next to malloc ("forward
    # __libc interface" in its alloc-override.c). In a static link those
    # definitions are taken in place of musl's, and what the libc allocates for
    # itself comes from the malloc of the image after all. Every file of musl
    # that uses these names gets them from this header.
    replace("src/include/stdlib.h", "hidden void *__libc_malloc(size_t);", """#define __libc_malloc __bun_libc_malloc
#define __libc_malloc_impl __bun_libc_malloc_impl
#define __libc_calloc __bun_libc_calloc
#define __libc_realloc __bun_libc_realloc
#define __libc_free __bun_libc_free

hidden void *__libc_malloc(size_t);""")

    # Emulated TLS. The memory comes from the allocator that musl keeps for
    # itself (__libc_malloc, __libc_calloc, __libc_free), never from the
    # public malloc family: the malloc of the image may read thread locals
    # (mimalloc does), which would come back here.
    # __libc_free is in mallocng's free.c, so a reference to it also makes
    # mallocng the allocator behind __libc_malloc (and not the bump allocator
    # of lite_malloc.c, whose blocks cannot be freed).
    write("src/thread/bun_emutls.c", """#include <stdlib.h>
#include <string.h>
#include "pthread_impl.h"
#include "lock.h"
#include "atomic.h"

struct emutls_control { size_t size, align; uintptr_t index; void *value; };
struct emutls_array { size_t count; void *slots[]; };

static volatile int emutls_lock[1];
static uintptr_t emutls_next;

/* The allocator aligns to 16. An object can ask for more, so every object
   sits in a block that is larger by the alignment and by one word: the word
   in front of the object holds the address of the block. */
static void *emutls_object(struct emutls_control *c)
{
	size_t align = c->align < sizeof(void *) ? sizeof(void *) : c->align;
	if (align & (align - 1)) a_crash();
	char *block = __libc_malloc(sizeof(void *) + align - 1 + c->size);
	if (!block) a_crash();
	char *p = (char *)(((uintptr_t)block + sizeof(void *) + align - 1) & -align);
	((void **)p)[-1] = block;
	if (c->value) memcpy(p, c->value, c->size);
	else memset(p, 0, c->size);
	return p;
}

static void *emutls_slow(struct emutls_control *c)
{
	pthread_t self = __pthread_self();
	LOCK(emutls_lock);
	if (!c->index) c->index = ++emutls_next;
	uintptr_t i = c->index;
	UNLOCK(emutls_lock);
	struct emutls_array *a = self->bun_emutls;
	if (!a || a->count < i) {
		size_t n = i + 16;
		struct emutls_array *b = __libc_calloc(1, sizeof *b + n * sizeof(void *));
		if (!b) a_crash();
		if (a) memcpy(b->slots, a->slots, a->count * sizeof(void *));
		b->count = n;
		__libc_free(a);
		self->bun_emutls = a = b;
	}
	return a->slots[i - 1] = emutls_object(c);
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
	pthread_t self = __pthread_self();
	struct emutls_array *a = self->bun_emutls;
	if (!a) return;
	self->bun_emutls = 0;
	for (size_t i = 0; i < a->count; i++)
		if (a->slots[i]) __libc_free(((void **)a->slots[i])[-1]);
	__libc_free(a);
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

    # Signal return trampoline, see restorer(). syscall_arch.h of both
    # architectures defines BUN_HOST_RESTORER.
    replace("src/signal/sigaction.c", """		ksa.restorer = (sa->sa_flags & SA_SIGINFO) ? __restore_rt : __restore;
""", """		ksa.restorer = (sa->sa_flags & SA_SIGINFO) ? __restore_rt : __restore;
#ifdef BUN_HOST_RESTORER
		if (__bun_host.os != BUN_OS_LINUX) ksa.restorer = BUN_HOST_RESTORER;
#endif
""")

    # Stack of the main thread. musl probes for it with mremap, which only a
    # Linux kernel answers in a way that means something (and the loop would
    # not end on a host that refuses every mremap). Another host made that
    # stack itself and is asked for it.
    replace("src/thread/pthread_getattr_np.c", """	} else {
		char *p = (void *)libc.auxv;
""", """	} else if (__bun_host.os != BUN_OS_LINUX) {
		unsigned long bounds[2];
		long r = (__bun_host.syscall)(BUN_SYS_main_stack, (long)bounds, 0, 0, 0, 0, 0);
		if (r) return -r;
		a->_a_stackaddr = bounds[1];
		a->_a_stacksize = bounds[1] - bounds[0];
	} else {
		char *p = (void *)libc.auxv;
""")
    replace("src/thread/pthread_getattr_np.c", '#include "libc.h"', '#include "libc.h"\n#include "bun_host.h"')


VFORK_C = """#define _GNU_SOURCE
#include <unistd.h>
#include <signal.h>
#include "syscall.h"

hidden pid_t __vfork_linux(void);

pid_t vfork(void)
{
	if (__bun_host.os == BUN_OS_LINUX)
		__attribute__((musttail)) return __vfork_linux();
#ifdef SYS_fork
	return __syscall_ret((__bun_host.syscall)(SYS_fork, 0, 0, 0, 0, 0, 0));
#else
	return __syscall_ret((__bun_host.syscall)(SYS_clone, SIGCHLD, 0, 0, 0, 0, 0));
#endif
}
"""


def vfork(arch):
    # The child runs on the parent's stack and returns from vfork() before the
    # parent does, so the Linux path must not leave a frame of this function
    # behind. musttail makes the compiler guarantee that. Other hosts get the
    # request that musl's generic vfork() makes: fork.
    move_asm(f"src/process/{arch}/vfork.s", f"src/process/{arch}/vfork_linux.s", "vfork", "__vfork_linux", hide=True)
    write(f"src/process/{arch}/vfork.c", VFORK_C)


def restorer(arch, attribute=""):
    # Signal return. restore.s stays the instructions that the kernel,
    # debuggers and unwinders know (x86_64 "mov $15,%rax; syscall", aarch64
    # "mov x8,#139; svc 0"): a dispatcher in front of them would break
    # unwinding through signal frames on Linux, and sigreturn needs the stack
    # pointer exactly as the handler left it. The choice is made in
    # sigaction() instead: a host that is not Linux is handed this function.
    write(f"src/signal/{arch}/bun_restore.c", f"""#include "syscall.h"

{attribute}hidden void __bun_restore_host(void)
{{
	(__bun_host.syscall)(SYS_rt_sigreturn, 0, 0, 0, 0, 0, 0);
	for (;;);
}}
""")


def x86_64():
    # Every "syscall" instruction of the x86_64 tree and what guards it:
    #   arch/x86_64/syscall_arch.h         branch on __bun_host.os, below
    #   src/thread/x86_64/clone.s          now __clone_linux, called by clone.c on Linux only
    #   src/thread/x86_64/__unmapself.s    now __unmapself_linux, called by __unmapself.c on Linux only
    #   src/thread/x86_64/syscall_cp.s     __syscall_cp_c returns before it on other hosts (common())
    #   src/process/x86_64/vfork.s         now __vfork_linux, called by vfork.c on Linux only
    #   src/signal/x86_64/restore.s        unchanged. It is entered only through a signal frame that
    #                                      the Linux kernel built. Other hosts get __bun_restore_host.
    #   src/thread/x86_64/__set_thread_area.s   now C, arch_prctl through __syscall
    # and every use of a segment register:
    #   arch/x86_64/pthread_arch.h         __get_tp(), below: fs on Linux, gs on the other hosts
    #   src/ldso/x86_64/tlsdesc.s          dynamic linker only, not part of a static image
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
    write("arch/x86_64/syscall_arch.h", "".join(out) + "\n" + tail + """
hidden void __bun_restore_host(void);
#define BUN_HOST_RESTORER __bun_restore_host
""")

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

    vfork("x86_64")
    # A handler that a host calls like the kernel does returns here with
    # "ret": the stack pointer is then a multiple of 16, which is not what a
    # function finds after a call.
    restorer("x86_64", "__attribute__((force_align_arg_pointer))\n")

    # Hand-written assembly that keeps values below the stack pointer (the red
    # zone of the System V ABI). -mno-red-zone does not reach assembly files,
    # and Windows may write below the stack pointer at any time.
    replace("src/fenv/x86_64/fenv.s", """1:	stmxcsr -8(%rsp)
	and $0x3f,%eax
	or %eax,-8(%rsp)
	test %ecx,-8(%rsp)
	jz 1f
	not %ecx
	and %ecx,-8(%rsp)
	ldmxcsr -8(%rsp)
1:	xor %eax,%eax
	ret
""", """1:	push %rdx
	stmxcsr (%rsp)
	and $0x3f,%eax
	or %eax,(%rsp)
	test %ecx,(%rsp)
	jz 1f
	not %ecx
	and %ecx,(%rsp)
	ldmxcsr (%rsp)
1:	pop %rdx
	xor %eax,%eax
	ret
""")
    replace("src/fenv/x86_64/fenv.s", """	and $0x3f,%edi
	stmxcsr -8(%rsp)
	or %edi,-8(%rsp)
	ldmxcsr -8(%rsp)
	xor %eax,%eax
	ret
""", """	and $0x3f,%edi
	push %rax
	stmxcsr (%rsp)
	or %edi,(%rsp)
	ldmxcsr (%rsp)
	pop %rax
	xor %eax,%eax
	ret
""")
    replace("src/math/x86_64/exp2l.s", """	movl $0xc2820000,-4(%rsp)
	flds -4(%rsp)
""", """	push %rax
	movl $0xc2820000,(%rsp)
	flds (%rsp)
	pop %rax
""")
    for path in ("src/fenv/x86_64/fenv.s", "src/math/x86_64/exp2l.s"):
        assert "-8(%rsp)" not in read(path) and "-4(%rsp)" not in read(path), path


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

    vfork("aarch64")
    restorer("aarch64")


common()
x86_64()
aarch64()
print("patched", root)
