// clang -mtune=native -O3 -shared ./plus100.c -o plus100.dylib
#include <stdint.h>

int32_t plus100(int32_t a);
int32_t plus100(int32_t a) { return a + 100; }

void noop(void);
void noop(void) {}