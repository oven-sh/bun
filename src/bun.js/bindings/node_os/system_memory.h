#ifndef SYSTEM_MEMORY_LIB
#define SYSTEM_MEMORY_LIB

#include <stdint.h>

extern "C" {
    uint64_t getFreeMemoryDarwin_B();
}

#endif