/*
 * Authored by Alex Hultman, 2018-2021.
 * Intellectual property of third-party.

 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 *     http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#ifndef UWS_WEBSOCKETEXTENSIONS_H
#define UWS_WEBSOCKETEXTENSIONS_H

/* Publish compresses per receiving socket (see TopicTree drain in App.h), so a
 * socket may be downgraded to SHARED_COMPRESSOR while the context is dedicated. */

#include <climits>
#include <cctype>
#include <string>
#include <string_view>
#include <tuple>

namespace uWS {

enum ExtensionTokens {
    /* Standard permessage-deflate tokens */
    TOK_PERMESSAGE_DEFLATE = 1838,
    TOK_SERVER_NO_CONTEXT_TAKEOVER = 2807,
    TOK_CLIENT_NO_CONTEXT_TAKEOVER = 2783,
    TOK_SERVER_MAX_WINDOW_BITS = 2372,
    TOK_CLIENT_MAX_WINDOW_BITS = 2348,
    /* Non-standard alias for Safari */
    TOK_X_WEBKIT_DEFLATE_FRAME = 2149,
    TOK_NO_CONTEXT_TAKEOVER = 2049,
    TOK_MAX_WINDOW_BITS = 1614

};

struct ExtensionsParser {
private:
    int *lastInteger = nullptr;

    /* RFC 7692 7.1: an offer with a repeated, unknown or misvalued parameter must be declined */
    void setFlag(bool &flag, bool allowed) {
        if (flag || !allowed) {
            invalid = true;
        }
        flag = true;
        lastInteger = nullptr;
    }

    /* A window parameter without a value is stored as 1 until its integer arrives */
    void setWindow(int &window, bool allowed) {
        if (window || !allowed) {
            invalid = true;
        }
        window = 1;
        lastInteger = &window;
    }

public:
    /* Standard */
    bool perMessageDeflate = false;
    bool serverNoContextTakeover = false;
    bool clientNoContextTakeover = false;
    int serverMaxWindowBits = 0;
    int clientMaxWindowBits = 0;

    /* Non-standard Safari */
    bool xWebKitDeflateFrame = false;
    bool noContextTakeover = false;
    int maxWindowBits = 0;

    bool invalid = false;

    /* Returns 0 at the end of the input, and also for the value "0" (see the parameter loop) */
    int getToken(const char *&in, const char *stop) {
        while (in != stop && !isalnum(*in)) {
            in++;
        }

        /* Don't care more than this for now */
        static_assert(SHRT_MIN > INT_MIN, "Integer overflow fix is invalid for this platform, report this as a bug!");

        int hashedToken = 0;
        while (in != stop && (isalnum(*in) || *in == '-' || *in == '_')) {
            if (isdigit(*in)) {
                /* This check is a quick and incorrect fix for integer overflow
                 * in oss-fuzz but we don't care as it doesn't matter either way */
                if (hashedToken > SHRT_MIN && hashedToken < SHRT_MAX) {
                    hashedToken = hashedToken * 10 - (*in - '0');
                }
            } else {
                hashedToken += *in;
            }
            in++;
        }
        return hashedToken;
    }

    /* Like getToken, but tells the end of the input apart from the value "0" */
    bool nextToken(const char *&in, const char *stop, int &token) {
        const char *before = in;
        token = getToken(in, stop);
        return token || (in != before && isalnum(in[-1]));
    }

    ExtensionsParser(const char *data, size_t length) {
        const char *stop = data + length;
        int token = 0;

        /* Ignore anything before permessage-deflate or x-webkit-deflate-frame */
        while (nextToken(data, stop, token) && token != TOK_PERMESSAGE_DEFLATE && token != TOK_X_WEBKIT_DEFLATE_FRAME);

        /* What protocol are we going to use? */
        perMessageDeflate = (token == TOK_PERMESSAGE_DEFLATE);
        xWebKitDeflateFrame = (token == TOK_X_WEBKIT_DEFLATE_FRAME);

        /* Parameters of this extension end at the next comma (RFC 6455 9.1) */
        for (const char *p = data; p != stop; p++) {
            if (*p == ',') {
                stop = p;
                break;
            }
        }

        while (nextToken(data, stop, token)) {
            switch (token) {
            case TOK_NO_CONTEXT_TAKEOVER:
                setFlag(noContextTakeover, xWebKitDeflateFrame);
                break;
            case TOK_MAX_WINDOW_BITS:
                setWindow(maxWindowBits, xWebKitDeflateFrame);
                break;
            case TOK_SERVER_NO_CONTEXT_TAKEOVER:
                setFlag(serverNoContextTakeover, perMessageDeflate);
                break;
            case TOK_CLIENT_NO_CONTEXT_TAKEOVER:
                setFlag(clientNoContextTakeover, perMessageDeflate);
                break;
            case TOK_SERVER_MAX_WINDOW_BITS:
                setWindow(serverMaxWindowBits, perMessageDeflate);
                break;
            case TOK_CLIENT_MAX_WINDOW_BITS:
                setWindow(clientMaxWindowBits, perMessageDeflate);
                break;
            default:
                /* An integer is the value of the window parameter right before it; anything else is unknown.
                 * Every window parameter takes 8..15, so a smaller value can never collide with the
                 * "no value" marker 1 (the upper bound is checked where the window is used). */
                if (token < 0 && -token >= 8 && lastInteger) {
                    *lastInteger = -token;
                    lastInteger = nullptr;
                } else {
                    invalid = true;
                }
                break;
            }
        }
    }
};

/* Lower our compressor (0 = shared, else windowBits) to what the peer demands.
 * Returns false when the demand cannot be honoured, in which case the offer must be declined. */
static inline bool negotiateCompressionWindow(int &compressionWindow, bool peerNoContextTakeover, int peerMaxWindowBits) {
    /* The value must be 9..15: a missing value is stored as 1, and zlib cannot deflate with 8 */
    if (peerMaxWindowBits && (peerMaxWindowBits < 9 || peerMaxWindowBits > 15)) {
        return false;
    }

    /* Only the shared compressor resets its context per message */
    if (peerNoContextTakeover) {
        compressionWindow = 0;
    }

    /* The shared compressor always uses the full window, so it cannot be lowered */
    if (peerMaxWindowBits && peerMaxWindowBits < 15) {
        if (!compressionWindow) {
            return false;
        }
        compressionWindow = std::min<int>(peerMaxWindowBits, compressionWindow);
    }

    return true;
}

/* Takes what we (the server) wants, returns what we got */
static inline std::tuple<bool, int, int, std::string_view> negotiateCompression(bool wantCompression, int wantedCompressionWindow, int wantedInflationWindow, std::string_view offer) {

    /* If we don't want compression then we are done here */
    if (!wantCompression) {
        return {false, 0, 0, ""};
    }

    ExtensionsParser ep(offer.data(), offer.length());

    /* We must decline rather than silently drop or alter what we cannot honour (RFC 7692 7.1) */
    if (ep.invalid) {
        return {false, 0, 0, ""};
    }

    static thread_local std::string response;
    response = "";

    int compressionWindow = wantedCompressionWindow;
    int inflationWindow = wantedInflationWindow;
    bool compression = false;

    if (ep.xWebKitDeflateFrame) {
        /* We now have compression */
        compression = true;
        response = "x-webkit-deflate-frame";

        if (!negotiateCompressionWindow(compressionWindow, ep.noContextTakeover, ep.maxWindowBits)) {
            return {false, 0, 0, ""};
        }

        /* We decide our own inflation sliding window (and their compression sliding window) */
        if (wantedInflationWindow < 15) {
            if (!wantedInflationWindow) {
                response += "; no_context_takeover";
            } else {
                response += "; max_window_bits=" + std::to_string(wantedInflationWindow);
            }
        }
    } else if (ep.perMessageDeflate) {
        /* We now have compression */
        compression = true;
        response = "permessage-deflate";

        /* client_max_window_bits may come without a value (stored as 1); with one it must be 8..15 */
        if (ep.clientMaxWindowBits > 15) {
            return {false, 0, 0, ""};
        }

        if (ep.clientNoContextTakeover) {
            inflationWindow = 0;
        } else if (ep.clientMaxWindowBits > 1) {
            inflationWindow = std::min<int>(ep.clientMaxWindowBits, inflationWindow);
        }

        /* Whatever we have now, write */
        if (inflationWindow < 15) {
            if (!inflationWindow || !ep.clientMaxWindowBits) {
                response += "; client_no_context_takeover";
                inflationWindow = 0;
            } else {
                response += "; client_max_window_bits=" + std::to_string(inflationWindow);
            }
        }

        /* The client may forbid context takeover toward it, or lower our window */
        if (!negotiateCompressionWindow(compressionWindow, ep.serverNoContextTakeover, ep.serverMaxWindowBits)) {
            return {false, 0, 0, ""};
        }

        /* Whatever we have now, write. Accepting an offered server_max_window_bits
         * means echoing it, even when it is 15 (RFC 7692 7.1.2.1) */
        if (!compressionWindow) {
            response += "; server_no_context_takeover";
        }
        if (ep.serverMaxWindowBits || (compressionWindow && compressionWindow < 15)) {
            response += "; server_max_window_bits=" + std::to_string(compressionWindow ? compressionWindow : 15);
        }
    }

    /* A final sanity check */
    if ((compressionWindow && compressionWindow < 9) || compressionWindow > 15 || (inflationWindow && inflationWindow < 8) || inflationWindow > 15) {
        return {false, 0, 0, ""};
    }

    return {compression, compressionWindow, inflationWindow, response};
}

}

#endif // UWS_WEBSOCKETEXTENSIONS_H
