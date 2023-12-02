/* This is a fuzz test of the websocket extensions parser */

#define WIN32_EXPORT

#include <cstdio>
#include <string>
#include <cstdlib>

/* We test the websocket extensions parser */
#include "../src/WebSocketExtensions.h"

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {

    /* This one must not return shared compressor, or above 13 */
    {
        auto [negCompression, negCompressionWindow, negInflationWindow, response] = uWS::negotiateCompression(true, 13, 0, std::string_view((char *) data, size));

        if (negCompression) {
            /* If we want dedicated compression, we must not end up here! */
            free((void *) (negCompressionWindow == 0));

            /* Some more checks (freeing 0 does nothing) */
            free((void *) (negCompressionWindow > 13));
            free((void *) (negInflationWindow != 0));
            free((void *) (negInflationWindow < 0 || negInflationWindow > 15 || negCompressionWindow < 0 || negCompressionWindow > 15));
        }
    }

    /* This one must not return anything over 0 (only shared) */
    {
        auto [negCompression, negCompressionWindow, negInflationWindow, response] = uWS::negotiateCompression(true, 0, 0, std::string_view((char *) data, size));

        if (negCompression) {
            /* If we want shared compression, we must not end up here! */
            free((void *) (negCompressionWindow != 0));
        }
    }


    /* Whatever, this one must not negotiate anything */
    {
        auto [negCompression, negCompressionWindow, negInflationWindow, response] = uWS::negotiateCompression(false, 13, 15, std::string_view((char *) data, size));

        if (negCompression) {
            free((void *) -1);
        }
    }

    return 0;
}

