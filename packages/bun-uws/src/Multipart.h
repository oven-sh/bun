/*
 * Authored by Alex Hultman, 2018-2020.
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

/* Implements the multipart protocol. Builds atop parts of our common http parser (not yet refactored that way). */
/* https://www.w3.org/Protocols/rfc1341/7_2_Multipart.html */

#ifndef UWS_MULTIPART_H
#define UWS_MULTIPART_H

#include "MessageParser.h"

#include <string_view>
#include <optional>
#include <cstring>
#include <utility>
#include <cctype>

namespace uWS {

    /* This one could possibly be shared with ExtensionsParser to some degree */
    struct ParameterParser {

        /* Takes the line, commonly given as content-disposition header in the multipart */
        ParameterParser(std::string_view line) {
            remainingLine = line;
        }

        /* Returns next key/value where value can simply be empty.
         * If key (first) is empty then we are at the end */
        std::pair<std::string_view, std::string_view> getKeyValue() {
            auto key = getToken();
            auto op = getToken();

            if (!op.length()) {
                return {key, ""};
            }

            if (op[0] != ';') {
                auto value = getToken();
                /* Strip ; or if at end, nothing */
                getToken();
                return {key, value};
            }

            return {key, ""};
        }

    private:
        std::string_view remainingLine;

        /* Consumes a token from the line. Will "unquote" strings */
        std::string_view getToken() {
            /* Strip whitespace */
            while (remainingLine.length() && isspace(remainingLine[0])) {
                remainingLine.remove_prefix(1);
            }

            if (!remainingLine.length()) {
                /* All we had was space */
                return {};
            } else {
                /* Are we at an operator? */
                if (remainingLine[0] == ';' || remainingLine[0] == '=') {
                    auto op = remainingLine.substr(0, 1);
                    remainingLine.remove_prefix(1);
                    return op;
                } else {
                    /* Are we at a quoted string? */
                    if (remainingLine[0] == '\"') {
                        /* Remove first quote and start counting */
                        remainingLine.remove_prefix(1);
                        auto quote = remainingLine;
                        int quoteLength = 0;

                        /* Read anything until other double quote appears */
                        while (remainingLine.length() && remainingLine[0] != '\"') {
                            remainingLine.remove_prefix(1);
                            quoteLength++;
                        }

                        /* We can't remove_prefix if we have nothing to remove */
                        if (!remainingLine.length()) {
                            return {};
                        }

                        remainingLine.remove_prefix(1);
                        return quote.substr(0, quoteLength);
                    } else {
                        /* Read anything until ; = space or end */
                        std::string_view token = remainingLine;

                        int tokenLength = 0;
                        while (remainingLine.length() && remainingLine[0] != ';' && remainingLine[0] != '=' && !isspace(remainingLine[0])) {
                            remainingLine.remove_prefix(1);
                            tokenLength++;
                        }

                        return token.substr(0, tokenLength);
                    }
                }
            }

            /* Nothing */
            return "";
        }
    };

    struct MultipartParser {

        /* 2 chars of hyphen + 1 - 70 chars of boundary */
        char prependedBoundaryBuffer[72];
        std::string_view prependedBoundary;
        std::string_view remainingBody;
        bool first = true;

        /* I think it is more than sane to limit this to 10 per part */
        //static const int MAX_HEADERS = 10;

        /* Construct the parser based on contentType (reads boundary) */
        MultipartParser(std::string_view contentType) {

            /* We expect the form "multipart/something;somethingboundary=something" */
            if (contentType.length() < 10 || contentType.substr(0, 10) != "multipart/") {
                return;
            }

            /* For now we simply guess boundary will lie between = and end. This is not entirely
            * standards compliant as boundary may be expressed with or without " and spaces */
            auto equalToken = contentType.find('=', 10);
            if (equalToken != std::string_view::npos) {

                /* Boundary must be less than or equal to 70 chars yet 1 char or longer */
                std::string_view boundary = contentType.substr(equalToken + 1);
                if (!boundary.length() || boundary.length() > 70) {
                    /* Invalid size */
                    return;
                }

                /* Prepend it with two hyphens */
                prependedBoundaryBuffer[0] = prependedBoundaryBuffer[1] = '-';
                memcpy(&prependedBoundaryBuffer[2], boundary.data(), boundary.length());

                prependedBoundary = {prependedBoundaryBuffer, boundary.length() + 2};
            }
        }

        /* Is this even a valid multipart request? */
        bool isValid() {
            return prependedBoundary.length() != 0;
        }

        /* Set the body once, before getting any parts */
        void setBody(std::string_view body) {
            remainingBody = body;
        }

        /* Parse out the next part's data, filling the headers. Returns nullopt on end or error. */
        std::optional<std::string_view> getNextPart(std::pair<std::string_view, std::string_view> *headers) {

            /* The remaining two hyphens should be shorter than the boundary */
            if (remainingBody.length() < prependedBoundary.length()) {
                /* We are done now */
                return std::nullopt;
            }

            if (first) {
                auto nextBoundary = remainingBody.find(prependedBoundary);
                if (nextBoundary == std::string_view::npos) {
                    /* Cannot parse */
                    return std::nullopt;
                }

                /* Toss away boundary and anything before it */
                remainingBody.remove_prefix(nextBoundary + prependedBoundary.length());
                first = false;
            }

            auto nextEndBoundary = remainingBody.find(prependedBoundary);
            if (nextEndBoundary == std::string_view::npos) {
                /* Cannot parse (or simply done) */
                return std::nullopt;
            }

            std::string_view part = remainingBody.substr(0, nextEndBoundary);
            remainingBody.remove_prefix(nextEndBoundary + prependedBoundary.length());

            /* Also strip rn before and rn after the part */
            if (part.length() < 4) {
                /* Cannot strip */
                return std::nullopt;
            }
            part.remove_prefix(2);
            part.remove_suffix(2);

            /* We are allowed to post pad like this because we know the boundary is at least 2 bytes */
            /* This makes parsing a second pass invalid, so you can only iterate over parts once */
            memset((char *) part.data() + part.length(), '\r', 1);

            /* For this to be a valid part, we need to consume at least 4 bytes (\r\n\r\n) */
            int consumed = getHeaders((char *) part.data(), (char *) part.data() + part.length(), headers);

            if (!consumed) {
                /* This is an invalid part */
                return std::nullopt;
            }

            /* Strip away the headers from the part body data */
            part.remove_prefix(consumed);

            /* Now pass whatever is remaining of the part */
            return part;
        }
    };

}

#endif
