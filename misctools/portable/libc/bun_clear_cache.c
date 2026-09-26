/* __clear_cache for the libc of an aarch64 image.

   After code was written to memory, the processor has to be told before it
   runs that memory: its instruction cache may hold what was there before. A
   compiler turns __builtin___clear_cache into a call of this function, and
   JavaScriptCore calls it for every piece of code that its JIT writes or
   changes (ARM64Assembler::cacheFlush).

   On Linux the function does the work itself, with the instructions that
   Linux lets a program use (the same steps as the __clear_cache of
   compiler-rt). Every other system has a call for it, and whether the
   instructions are allowed there is not written down anywhere, so on another
   host this is a request: BUN_SYS_clear_cache(start, end).

   jsc/build-aarch64.ts copies this file to src/thread/aarch64 of musl, and
   takes clear_cache.c.o out of the builtins, so that this is the only one. */
#include <stdint.h>
#include "bun_host.h"

#define BUN_SYS_clear_cache 0x62756e03

void __clear_cache(void *start, void *end)
{
	if (__bun_host.os != BUN_OS_LINUX) {
		(__bun_host.syscall)(BUN_SYS_clear_cache, (long)start, (long)end, 0, 0, 0, 0);
		return;
	}
	/* CTR_EL0: bits 0 to 3 and 16 to 19 are the logarithms of the words in a line of the
	   instruction cache and of the data cache. Bit 28 (IDC): the data cache needs no
	   cleaning for this. Bit 29 (DIC): the instruction cache needs no invalidation. */
	static uint64_t type;
	uint64_t ctr = type, from = (uint64_t)start, to = (uint64_t)end;
	if (!ctr) {
		__asm__ __volatile__("mrs %0, ctr_el0" : "=r"(ctr));
		type = ctr;
	}
	if (!(ctr >> 28 & 1)) {
		uint64_t line = 4u << (ctr >> 16 & 15);
		for (uint64_t at = from & ~(line - 1); at < to; at += line)
			__asm__ __volatile__("dc cvau, %0" : : "r"(at));
	}
	__asm__ __volatile__("dsb ish");
	if (!(ctr >> 29 & 1)) {
		uint64_t line = 4u << (ctr & 15);
		for (uint64_t at = from & ~(line - 1); at < to; at += line)
			__asm__ __volatile__("ic ivau, %0" : : "r"(at));
		__asm__ __volatile__("dsb ish");
	}
	__asm__ __volatile__("isb");
}
