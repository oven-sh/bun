// What a function does that bun's crates call and that this program is built without (build.ts writes
// one for each name the linker could not resolve): it says which one it is, and the program stops.
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

__attribute__((noreturn, visibility("default"))) void bun_slice_missing_symbol(const char *name) {
  static const char before[] = "bun_loop_slice: ";
  static const char after[] = " is a function of bun that this program is built without\n";
  (void)!write(2, before, sizeof before - 1);
  (void)!write(2, name, strlen(name));
  (void)!write(2, after, sizeof after - 1);
  abort();
}
