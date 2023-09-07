/* This is a temporary fix since we do not support this mode with pub/sub yet */
#define UWS_ALLOW_SHARED_AND_DEDICATED_COMPRESSOR_MIX

/* Zlib bug should not affect testing */
#define UWS_ALLOW_8_WINDOW_BITS

#include "../src/WebSocketExtensions.h"

#include <iostream>

void testNegotiation(bool wantCompression, int wantedCompressionWindow, int wantedInflationWindow, std::string_view offer,
                    bool negCompression, int negCompressionWindow, int negInflationWindow, std::string_view negResponse) {

    auto [compression, compressionWindow, inflationWindow, response] = uWS::negotiateCompression(wantCompression, wantedCompressionWindow, wantedInflationWindow, offer);

    if (compression == negCompression && compressionWindow == negCompressionWindow && inflationWindow == negInflationWindow && response == negResponse) {
        std::cout << "PASS" << std::endl;
    } else {
        std::cout << "FAIL: <" << response << "> is not expected <" << negResponse << ">" << std::endl;
    }

}

int main() {

    /* Both parties must indicate compression for it to negotiate */
    testNegotiation(false, 15, 15, "permessage-deflate", false, 0, 0, "");
    testNegotiation(false, 15, 15, "x-webkit-deflate-frame", false, 0, 0, "");
    testNegotiation(true, 15, 15, "", false, 15, 15, "");
    testNegotiation(true, 15, 15, "", false, 15, 15, "");

    /* client_max_window_bits can only be used if the client indicates support */
    testNegotiation(true, 15, 11, "permessage-deflate; ", true, 15, 0, "permessage-deflate; client_no_context_takeover");
    testNegotiation(true, 15, 0, "permessage-deflate; ", true, 15, 0, "permessage-deflate; client_no_context_takeover");
    testNegotiation(true, 15, 11, "permessage-deflate; client_max_window_bits=14", true, 15, 11, "permessage-deflate; client_max_window_bits=11");
    testNegotiation(true, 15, 11, "permessage-deflate; client_max_window_bits=9", true, 15, 9, "permessage-deflate; client_max_window_bits=9");

    /* server_max_window_bits can always be used */
    testNegotiation(true, 0, 15, "permessage-deflate; ", true, 0, 15, "permessage-deflate; server_no_context_takeover");
    testNegotiation(true, 8, 15, "permessage-deflate; ", true, 8, 15, "permessage-deflate; server_max_window_bits=8");
    testNegotiation(true, 15, 15, "permessage-deflate; server_max_window_bits=8", true, 8, 15, "permessage-deflate; server_max_window_bits=8");
    testNegotiation(true, 11, 15, "permessage-deflate; server_max_window_bits=14", true, 11, 15, "permessage-deflate; server_max_window_bits=11");

    /* x-webkit-deflate-frame has no particular rules */
    testNegotiation(true, 11, 15, "x-webkit-deflate-frame; no_context_takeover; max_window_bits=8", true, 0, 15, "x-webkit-deflate-frame");
    testNegotiation(true, 11, 12, "x-webkit-deflate-frame; no_context_takeover; max_window_bits=8", true, 0, 12, "x-webkit-deflate-frame; max_window_bits=12");
    testNegotiation(true, 11, 12, "x-webkit-deflate-frame; max_window_bits=8", true, 8, 12, "x-webkit-deflate-frame; max_window_bits=12");
    testNegotiation(true, 15, 0, "x-webkit-deflate-frame; max_window_bits=15", true, 15, 0, "x-webkit-deflate-frame; no_context_takeover");

    /* Defaults */
    testNegotiation(true, 15, 15, "x-webkit-deflate-frame", true, 15, 15, "x-webkit-deflate-frame");
    testNegotiation(true, 15, 15, "permessage-deflate", true, 15, 15, "permessage-deflate");

    /* Fail on invalid values */
    testNegotiation(true, 15, 15, "x-webkit-deflate-frame; max_window_bits=3", false, 0, 0, "");
    /* This one doesn't fail, but at least ignores the too high value */
    testNegotiation(true, 15, 15, "x-webkit-deflate-frame; max_window_bits=16", true, 15, 15, "x-webkit-deflate-frame");

    testNegotiation(true, 15, 15, "permessage-deflate; server_max_window_bits=3", false, 0, 0, "");
    testNegotiation(true, 15, 15, "permessage-deflate; client_max_window_bits=3", false, 0, 0, "");

    /* Same here; these won't fail but just be ignored */
    testNegotiation(true, 15, 15, "permessage-deflate; server_max_window_bits=17", true, 15, 15, "permessage-deflate");
    testNegotiation(true, 15, 15, "permessage-deflate; client_max_window_bits=17", true, 15, 15, "permessage-deflate");

    std::cout << "ALL PASS" << std::endl;
}