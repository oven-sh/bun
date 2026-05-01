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

/* There is a new, huge bug scenario that needs to be fixed:
 * pub/sub does not support being in DEDICATED_COMPRESSOR-mode while having
 * some clients downgraded to SHARED_COMPRESSOR - we cannot allow the client to
 * demand a downgrade to SHARED_COMPRESSOR (yet) until we fix that scenario in pub/sub */
// #define UWS_ALLOW_SHARED_AND_DEDICATED_COMPRESSOR_MIX

/* We forbid negotiating 8 windowBits since Zlib has a bug with this */
// #define UWS_ALLOW_8_WINDOW_BITS

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

    ExtensionsParser(const char *data, size_t length) {
        const char *stop = data + length;
        int token = 1;

        /* Ignore anything before permessage-deflate or x-webkit-deflate-frame */
        for (; token && token != TOK_PERMESSAGE_DEFLATE && token != TOK_X_WEBKIT_DEFLATE_FRAME; token = getToken(data, stop));

        /* What protocol are we going to use? */
        perMessageDeflate = (token == TOK_PERMESSAGE_DEFLATE);
        xWebKitDeflateFrame = (token == TOK_X_WEBKIT_DEFLATE_FRAME);

        while ((token = getToken(data, stop))) {
            switch (token) {
            case TOK_X_WEBKIT_DEFLATE_FRAME:
                /* Duplicates not allowed/supported */
                return;
            case TOK_NO_CONTEXT_TAKEOVER:
                noContextTakeover = true;
                break;
            case TOK_MAX_WINDOW_BITS:
                maxWindowBits = 1;
                lastInteger = &maxWindowBits;
                break;
            case TOK_PERMESSAGE_DEFLATE:
                /* Duplicates not allowed/supported */
                return;
            case TOK_SERVER_NO_CONTEXT_TAKEOVER:
                serverNoContextTakeover = true;
                break;
            case TOK_CLIENT_NO_CONTEXT_TAKEOVER:
                clientNoContextTakeover = true;
                break;
            case TOK_SERVER_MAX_WINDOW_BITS:
                serverMaxWindowBits = 1;
                lastInteger = &serverMaxWindowBits;
                break;
            case TOK_CLIENT_MAX_WINDOW_BITS:
                clientMaxWindowBits = 1;
                lastInteger = &clientMaxWindowBits;
                break;
            default:
                if (token < 0 && lastInteger) {
                    *lastInteger = -token;
                }
                break;
            }
        }
    }
};

/* Takes what we (the server) wants, returns what we got */
static inline std::tuple<bool, int, int, std::string_view> negotiateCompression(bool wantCompression, int wantedCompressionWindow, int wantedInflationWindow, std::string_view offer) {

    /* If we don't want compression then we are done here */
    if (!wantCompression) {
        return {false, 0, 0, ""};
    }

    ExtensionsParser ep(offer.data(), offer.length());

    static thread_local std::string response;
    response = "";

    int compressionWindow = wantedCompressionWindow;
    int inflationWindow = wantedInflationWindow;
    bool compression = false;

    if (ep.xWebKitDeflateFrame) {
        /* We now have compression */
        compression = true;
        response = "x-webkit-deflate-frame";

        /* If the other peer has DEMANDED us no sliding window,
         * we cannot compress with anything other than shared compressor */
        if (ep.noContextTakeover) {
            /* We must fail here right now (fix pub/sub) */
#ifndef UWS_ALLOW_SHARED_AND_DEDICATED_COMPRESSOR_MIX
            if (wantedCompressionWindow != 0) {
                return {false, 0, 0, ""};
            }
#endif

            compressionWindow = 0;
        }

        /* If the other peer has DEMANDED us to use a limited sliding window,
         * we have to limit out compression sliding window */
        if (ep.maxWindowBits && ep.maxWindowBits < compressionWindow) {
            compressionWindow = ep.maxWindowBits;
#ifndef UWS_ALLOW_8_WINDOW_BITS
            /* We cannot really deny this, so we have to disable compression in this case */
            if (compressionWindow == 8) {
                return {false, 0, 0, ""};
            }
#endif
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

        if (ep.clientNoContextTakeover) {
            inflationWindow = 0;
        } else if (ep.clientMaxWindowBits && ep.clientMaxWindowBits != 1) {
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

        /* This block basically lets the client lower it */
        if (ep.serverNoContextTakeover) {
        /* This is an important (temporary) fix since we haven't allowed
         * these two modes to mix, and pub/sub will not handle this case (yet) */
#ifdef UWS_ALLOW_SHARED_AND_DEDICATED_COMPRESSOR_MIX
            compressionWindow = 0;
#endif
        } else if (ep.serverMaxWindowBits) {
            compressionWindow = std::min<int>(ep.serverMaxWindowBits, compressionWindow);
#ifndef UWS_ALLOW_8_WINDOW_BITS
            /* Zlib cannot do windowBits=8, memLevel=1 so we raise it up to 9 minimum */
            if (compressionWindow == 8) {
                compressionWindow = 9;
            }
#endif
        }

        /* Whatever we have now, write */
        if (compressionWindow < 15) {
            if (!compressionWindow) {
                response += "; server_no_context_takeover";
            } else {
                response += "; server_max_window_bits=" + std::to_string(compressionWindow);
            }
        }
    }

    /* A final sanity check (this check does not actually catch too high values!) */
    if ((compressionWindow && compressionWindow < 8) || compressionWindow > 15 || (inflationWindow && inflationWindow < 8) || inflationWindow > 15) {
        return {false, 0, 0, ""};
    }

    return {compression, compressionWindow, inflationWindow, response};
}

}

#endif // UWS_WEBSOCKETEXTENSIONS_H
