/* The permission of a thread for memory that code is written to (aarch64 images).

   On Apple Silicon such memory is writable or executable, never both, and every
   thread says which of the two it wants. A program that was built for Linux
   knows nothing of that. There are two ways to run it there:

   1. The host does it where the processor reports a fault (host/host_posix.c,
      "code that is written"). The image needs nothing for that, and these two
      functions are not linked into it.
   2. The program says it. JavaScriptCore has the code, for Darwin: every write
      of its JIT is inside of a pair "the thread may write" and "the thread
      may execute" (performJITMemcpy, LinkBuffer), chosen when the program
      runs by one variable (g_jscConfig.useFastJITPermissions). The pair is two
      macros that a build may define (assembler/FastJITPermissions.h:
      OS_THREAD_SELF_RESTRICT, OS_THREAD_SELF_RESTRICT_SUPPORTED), and
      jsc/bun_jit_permissions.h defines them as the two functions of this file.

   BUN_SYS_jit_write_protect(what): 0 the thread may write, 1 the thread may
   execute, 2 the question whether this host is one where a thread has to say.

   jsc/build-aarch64.ts copies this file to src/thread/aarch64 of musl. */
#include "bun_host.h"

#define BUN_SYS_jit_write_protect 0x62756e04

int __bun_jit_write_protect_supported(void)
{
	if (__bun_host.os == BUN_OS_LINUX) return 0;
	return (__bun_host.syscall)(BUN_SYS_jit_write_protect, 2, 0, 0, 0, 0, 0) == 1;
}

void __bun_jit_write_protect(int execute)
{
	if (__bun_host.os == BUN_OS_LINUX) return;
	(__bun_host.syscall)(BUN_SYS_jit_write_protect, execute ? 1 : 0, 0, 0, 0, 0, 0);
}
