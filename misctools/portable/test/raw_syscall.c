// Third test program, x86-64: an image that does what no image may do. It issues a syscall
// instruction itself instead of asking the host table. On Linux by itself that simply
// works (exit code 42). Under the Linux test host the filter of the host has to end the
// process: exit code 99 and a message that names the offset of the instruction.
// test/run.sh runs it as a "must fail" test, which shows that a hosted run that passes
// issued no syscall from image code.
#include <stdio.h>

int main(void) {
  long result;
  printf("raw_syscall: the next request does not go through the host table\n");
  fflush(stdout);
#if defined(__x86_64__)
  __asm__ __volatile__("syscall" : "=a"(result) : "a"(39L /* getpid */) : "rcx", "r11", "memory");
#else
  result = 1;
#endif
  printf("raw_syscall: the kernel answered %ld\n", result);
  return result > 0 ? 42 : 1;
}
