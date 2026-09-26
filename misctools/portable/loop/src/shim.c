// The C of the loop slice that is not bun's: what stands where the program is built without a part of
// bun.
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

// What a function does that bun's crates call and that this program is built without (build.ts writes
// one for each name the linker could not resolve): it says which one it is, and the program stops.
__attribute__((noreturn, visibility("default"))) void bun_slice_missing_symbol(const char *name) {
  static const char before[] = "bun_loop_slice: ";
  static const char after[] = " is a function of bun that this program is built without\n";
  (void)!write(2, before, sizeof before - 1);
  (void)!write(2, name, strlen(name));
  (void)!write(2, after, sizeof after - 1);
  abort();
}

// src/jsc/bindings/wtf-bindings.cpp returns WTF::numberOfProcessorCores(), and the program has no
// WebKit. This is the number WTF asks a POSIX system for. The libc of the image asks the host.
__attribute__((visibility("default"))) int WTF__numberOfProcessorCores(void) {
  long cores = sysconf(_SC_NPROCESSORS_ONLN);
  return cores < 1 ? 1 : (int)cores;
}
