#!/usr/bin/env python3
"""Turn musl 1.2.5 (x86_64) into the libc of a portable image.

The image keeps the Linux ABI. Every place where musl reaches the OS goes
through `__bun_host`: on a Linux host it issues the real syscall, on any other
host it calls into the native stub that loaded the image. The thread pointer is
read through a segment register chosen at run time. No code is patched at load.
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


write("arch/x86_64/bun_host.h", """#ifndef BUN_HOST_H
#define BUN_HOST_H

#define BUN_OS_LINUX 1
#define BUN_OS_WINDOWS 2
#define BUN_OS_MACOS 3
#define AT_BUN_HOST 0x62756e00

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

args = ["a1", "a2", "a3", "a4", "a5", "a6"]
regs = ['"D"(a1)', '"S"(a2)', '"d"(a3)', '"r"(r10)', '"r"(r8)', '"r"(r9)']
out = ['#include "bun_host.h"\n\n#define __SYSCALL_LL_E(x) (x)\n#define __SYSCALL_LL_O(x) (x)\n']
for n in range(7):
    params = "".join(f", long {a}" for a in args[:n])
    host_args = ", ".join(args[:n] + ["0"] * (6 - n))
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

replace("src/env/__libc_start_main.c", """	libc.auxv = auxv = (void *)(envp+i+1);
""", """	libc.auxv = auxv = (void *)(envp+i+1);
	for (i=0; auxv[i]; i+=2) if (auxv[i]==AT_BUN_HOST) __bun_host = *(struct bun_host *)auxv[i+1];
""")
replace("src/env/__libc_start_main.c", '#include "libc.h"', '#include "libc.h"\n#include "bun_host.h"')

os.remove(os.path.join(root, "src/thread/x86_64/__set_thread_area.s"))
write("src/thread/x86_64/__set_thread_area.c", """#include "pthread_impl.h"
#include "syscall.h"

int __set_thread_area(void *p)
{
	return __syscall(SYS_arch_prctl, 0x1002, p);
}
""")

clone = read("src/thread/x86_64/clone.s").replace("__clone", "__clone_linux")
os.remove(os.path.join(root, "src/thread/x86_64/clone.s"))
write("src/thread/x86_64/clone_linux.s", clone)
write("src/thread/x86_64/clone.c", """#include <stdarg.h>
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
""")

unmap = read("src/thread/x86_64/__unmapself.s").replace("__unmapself", "__unmapself_linux")
os.remove(os.path.join(root, "src/thread/x86_64/__unmapself.s"))
write("src/thread/x86_64/unmapself_linux.s", unmap)
write("src/thread/x86_64/__unmapself.c", """#include "pthread_impl.h"
#include "bun_host.h"

hidden _Noreturn void __unmapself_linux(void *, size_t);

_Noreturn void __unmapself(void *base, size_t size)
{
	if (__bun_host.os == BUN_OS_LINUX) __unmapself_linux(base, size);
	__bun_host.thread_exit(base, size);
	for (;;);
}
""")

replace("src/thread/pthread_cancel.c", """	pthread_t self;
	long r;
	int st;
""", """	pthread_t self;
	long r;
	int st;

	if (__bun_host.os != BUN_OS_LINUX) return __syscall(nr, u, v, w, x, y, z);
""")
replace("src/thread/pthread_cancel.c", '#include "pthread_impl.h"', '#include "pthread_impl.h"\n#include "bun_host.h"')

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
print("patched", root)
