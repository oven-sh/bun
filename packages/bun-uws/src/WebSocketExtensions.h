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

#include <algorithm>
#include <string>
#include <string_view>
#include <tuple>
#include <utility>

namespace uWS {

/* Splits s on separator and calls f with each whitespace-trimmed part. Stops and returns false once f returns false. */
template <typename F>
static inline bool forEachPart(std::string_view s, char separator, F &&f) {
    for (size_t start = 0, end; start <= s.length(); start = end + 1) {
        end = std::min(s.find(separator, start), s.length());
        std::string_view part = s.substr(start, end - start);
        while (!part.empty() && (part.front() == ' ' || part.front() == '\t')) {
            part.remove_prefix(1);
        }
        while (!part.empty() && (part.back() == ' ' || part.back() == '\t')) {
            part.remove_suffix(1);
        }
        if (!f(part)) {
            return false;
        }
    }
    return true;
}

/* One permessage-deflate offer from a Sec-WebSocket-Extensions request header */
struct PerMessageDeflateOffer {
    bool serverNoContextTakeover = false;
    bool clientNoContextTakeover = false;
    /* 0 when absent */
    int serverMaxWindowBits = 0;
    int clientMaxWindowBits = 0;

    /* Returns 8..15, or 0 if invalid. Leading zeros are invalid. */
    static int parseWindowBits(std::string_view value) {
        if (value.length() >= 2 && value.front() == '"' && value.back() == '"') {
            value = value.substr(1, value.length() - 2);
        }
        if (value == "8" || value == "9") {
            return value[0] - '0';
        }
        if (value.length() == 2 && value[0] == '1' && value[1] >= '0' && value[1] <= '5') {
            return 10 + (value[1] - '0');
        }
        return 0;
    }

    /* Returns false for other extensions, and for offers RFC 7692 7.1 says to decline:
     * an unknown or repeated parameter, or an invalid value */
    bool parse(std::string_view offer) {
        bool isName = true;
        return forEachPart(offer, ';', [&](std::string_view part) {
            if (std::exchange(isName, false)) {
                return part == "permessage-deflate";
            }

            size_t equals = part.find('=');
            bool hasValue = equals != std::string_view::npos;
            std::string_view name = part.substr(0, equals);
            std::string_view value = hasValue ? part.substr(equals + 1) : std::string_view();

            if (name == "server_no_context_takeover") {
                return !hasValue && !std::exchange(serverNoContextTakeover, true);
            }
            if (name == "client_no_context_takeover") {
                return !hasValue && !std::exchange(clientNoContextTakeover, true);
            }
            if (name == "server_max_window_bits") {
                return !serverMaxWindowBits && (serverMaxWindowBits = parseWindowBits(value)) != 0;
            }
            if (name == "client_max_window_bits") {
                return !clientMaxWindowBits && (clientMaxWindowBits = hasValue ? parseWindowBits(value) : 15) != 0;
            }
            return false;
        });
    }
};

/* Takes what we (the server) wants, returns what we got. A window of 0 means the shared stream (no context takeover). */
static inline std::tuple<bool, int, int, std::string> negotiateCompression(bool wantCompression, int wantedCompressionWindow, int wantedInflationWindow, std::string_view offers) {

    /* If we don't want compression then we are done here */
    if (!wantCompression) {
        return {false, 0, 0, ""};
    }

    std::string response;
    int compressionWindow = 0;
    int inflationWindow = 0;

    /* Offers are listed in order of preference (RFC 7692 5.1). Accept the first one we can honor. */
    bool declinedAll = forEachPart(offers, ',', [&](std::string_view part) {
        PerMessageDeflateOffer offer;
        if (!offer.parse(part)) {
            return true;
        }

        compressionWindow = offer.serverNoContextTakeover ? 0 : wantedCompressionWindow;
        if (offer.serverMaxWindowBits) {
            /* The shared compressor always uses 15. An 8-bit window is fine: see compressOptionsFor(). */
            if (!compressionWindow && offer.serverMaxWindowBits < 15) {
                return true;
            }
            compressionWindow = std::min(compressionWindow, offer.serverMaxWindowBits);
        }

        inflationWindow = offer.clientNoContextTakeover ? 0 : wantedInflationWindow;
        if (offer.clientMaxWindowBits) {
            inflationWindow = std::min(inflationWindow, offer.clientMaxWindowBits);
        } else if (inflationWindow < 15) {
            /* We may only send client_max_window_bits if the client offered it, so fall back to no context takeover */
            inflationWindow = 0;
        }

        response = "permessage-deflate";
        if (!inflationWindow) {
            response += "; client_no_context_takeover";
        } else if (inflationWindow < 15) {
            response += "; client_max_window_bits=" + std::to_string(inflationWindow);
        }
        if (!compressionWindow) {
            response += "; server_no_context_takeover";
        }
        /* An accepted server_max_window_bits must be echoed in the response (RFC 7692 7.1.2.1) */
        if (offer.serverMaxWindowBits || (compressionWindow && compressionWindow < 15)) {
            response += "; server_max_window_bits=" + std::to_string(compressionWindow ? compressionWindow : 15);
        }
        return false;
    });

    if (declinedAll) {
        return {false, 0, 0, ""};
    }

    return {true, compressionWindow, inflationWindow, std::move(response)};
}

}

#endif // UWS_WEBSOCKETEXTENSIONS_H
