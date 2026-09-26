// What bun_core's start of the standard streams asks of bun's C++ (src/jsc/bindings/c-bindings.cpp), for a
// program that has bun's crates and none of bun's C++.
//
// bun_initialize_process has one implementation for POSIX and one for Windows in c-bindings.cpp, chosen by
// the preprocessor. This one is neither: it does the part of the POSIX one that bun_core reads back (which
// of the three streams is a terminal), and nothing on a Windows host. There bun_core's own code for
// Windows takes the handles and the console modes (bun_core::output::windows_stdio). Not done on Windows:
// a stream whose handle is invalid is not replaced by NUL, and no handler for Ctrl-C is installed.
#include <stdint.h>
#include <stdio.h>
#include <unistd.h>

unsigned long __bun_host_os(void);

/* Defined by bun_core. */
extern int32_t bun_stdio_tty[3];

int32_t bun_is_stdio_null[3] = {0, 0, 0};

void bun_initialize_process(void) {
  if (__bun_host_os() == 2) return;
  setvbuf(stdout, 0, _IONBF, 0);
  setvbuf(stderr, 0, _IONBF, 0);
  for (int fd = 0; fd < 3; fd++)
    if (isatty(fd)) bun_stdio_tty[fd] = 1;
}
