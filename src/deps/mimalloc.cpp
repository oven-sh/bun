#include "mimalloc.h"
#include <cstdio>

extern "C" void bun_configure_mimalloc()
{
    mi_option_set(mi_option_generic_collect, 10'000); // default
}
