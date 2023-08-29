extern "C" {
#include "quic.h"
}

namespace uWS {

    struct Http3Request {

        std::string_view getHeader(std::string_view key) {
            for (int i = 0, more = 1; more; i++) {
                char *name, *value;
                int name_length, value_length;
                if ((more = us_quic_socket_context_get_header(nullptr, i, &name, &name_length, &value, &value_length))) {
                    if (name_length == (int) key.length() && !memcmp(name, key.data(), key.length())) {
                        return {value, (size_t) value_length};
                    }
                }
            }
            return {nullptr, 0};
        }
    };
}