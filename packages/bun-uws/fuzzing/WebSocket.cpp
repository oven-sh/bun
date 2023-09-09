/* This is a fuzz test of the websocket parser */

#define WIN32_EXPORT

#include "helpers.h"

/* We test the websocket parser */
#include "../src/WebSocketProtocol.h"

struct Impl {
    static bool refusePayloadLength(uint64_t length, uWS::WebSocketState<true> *wState, void *s) {

        /* We need a limit */
        if (length > 16000) {
            return true;
        }

        /* Return ok */
        return false;
    }

    static bool setCompressed(uWS::WebSocketState<true> *wState, void *s) {
        /* We support it */
        return true;
    }

    static void forceClose(uWS::WebSocketState<true> *wState, void *s, std::string_view reason = {}) {

    }

    static bool handleFragment(char *data, size_t length, unsigned int remainingBytes, int opCode, bool fin, uWS::WebSocketState<true> *webSocketState, void *s) {

        if (opCode == uWS::TEXT) {
            if (!uWS::protocol::isValidUtf8((unsigned char *)data, length)) {
                /* Return break */
                return true;
            }
        } else if (opCode == uWS::CLOSE) {
            uWS::protocol::parseClosePayload((char *)data, length);
        }

        /* Return ok */
        return false;
    }
};

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {

    /* Create the parser state */
    uWS::WebSocketState<true> state;

    makeChunked(makePadded(data, size), size, [&state](const uint8_t *data, size_t size) {
        /* Parse it */
        uWS::WebSocketProtocol<true, Impl>::consume((char *) data, size, &state, nullptr);
    });

    return 0;
}

