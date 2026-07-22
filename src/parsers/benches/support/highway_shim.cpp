// Bench-only implementation of the `highway_memmem` C symbol Bun's Rust side
// calls (`src/highway`). The real implementation lives in
// `src/jsc/bindings/highway_strings.cpp`, which pulls in the full JSC/WebKit
// header tree via `root.h` and is not buildable standalone; for the parser
// bench/tests a libc `memmem` is sufficient.
#include <cstddef>
#include <cstdint>
#include <cstring>

extern "C" void* highway_memmem(const uint8_t* haystack, size_t haystack_len,
                                const uint8_t* needle, size_t needle_len) {
  return memmem(haystack, haystack_len, needle, needle_len);
}
