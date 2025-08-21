#include "mimalloc.h"
#include <cstdlib>

extern "C" void bun_configure_mimalloc()
{
    auto attempt = [](const char* env_var, mi_option_e option) {
        if (const char* value = std::getenv(env_var); value && value[0] != '\0') {
            char* value_end = nullptr;
            long option_value = std::strtol(value, &value_end, 10);
            if (value_end == value + std::strlen(value)) {
                mi_option_set(option, option_value);
                return true;
            }
        }

        return false;
    };

    if (!attempt("MIMALLOC_GENERIC_COLLECT", mi_option_generic_collect)) {
        mi_option_set(mi_option_generic_collect, 1'000); // mimalloc v3's default is 10,000
    }

    if (!attempt("MIMALLOC_GENERIC_ADMINISTRATIVE", mi_option_generic_administrative)) {
        mi_option_set(mi_option_generic_administrative, 20); // a good balance, it seems
    }
}
