/* For the build of WebKit with JSC_VARIANT=jit-permissions (jsc/build-aarch64.ts puts it in
   front of every file with -include): JavaScriptCore's own code for memory that is
   writable or executable for a thread, compiled into an image that is Linux inside, and
   chosen when the image runs.

   assembler/FastJITPermissions.h takes these two macros from a build that defines both,
   before it looks at the system. The functions are in the libc of the image
   (libc/bun_jit_permission.c): they ask the host, and only a host of Apple Silicon says yes.
   Everywhere else g_jscConfig.useFastJITPermissions stays false and the JIT writes as it
   does on Linux. No file of WebKit is changed for this. */
#ifndef BUN_JIT_PERMISSIONS_H
#define BUN_JIT_PERMISSIONS_H

#ifdef __cplusplus
extern "C" {
#endif
int __bun_jit_write_protect_supported(void);
void __bun_jit_write_protect(int execute);
#ifdef __cplusplus
}
#endif

#define OS_THREAD_SELF_RESTRICT_SUPPORTED(restriction) \
    (((restriction) == MemoryRestriction::kRwxToRw || (restriction) == MemoryRestriction::kRwxToRx) && __bun_jit_write_protect_supported())
#define OS_THREAD_SELF_RESTRICT(restriction) __bun_jit_write_protect((restriction) == MemoryRestriction::kRwxToRx)

#endif
