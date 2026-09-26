// Linked into a host that was compiled with -fprofile-instr-generate -fcoverage-mapping
// (test/coverage.ts). A host ends the process at once (_exit, TerminateProcess), which
// writes no profile, so the profile is written through the hook that the hosts call before.
extern void (*bun_host_before_exit)(void);
int __llvm_profile_write_file(void);

static void write_profile(void) { __llvm_profile_write_file(); }
__attribute__((constructor)) static void install(void) { bun_host_before_exit = write_profile; }
