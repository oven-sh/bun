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

/* This module implements URI query parsing and retrieval of value given key */

#ifndef UWS_QUERYPARSER_H
#define UWS_QUERYPARSER_H

#include <string_view>

namespace uWS {

    /* Takes raw query including initial '?' sign. Will inplace decode, so input will mutate */
    static inline std::string_view getDecodedQueryValue(std::string_view key, std::string_view rawQuery) {

        /* Can't have a value without a key */
        if (!key.length()) {
            return {};
        }

        /* Start with the whole querystring including initial '?' */
        std::string_view queryString = rawQuery;

        /* List of key, value could be cached for repeated fetches similar to how headers are, todo! */
        while (queryString.length()) {
            /* Find boundaries of this statement */
            std::string_view statement = queryString.substr(1, queryString.find('&', 1) - 1);

            /* Only bother if first char of key match (early exit) */
            if (statement.length() && statement[0] == key[0]) {
                /* Equal sign must be present and not in the end of statement */
                auto equality = statement.find('=');
                if (equality != std::string_view::npos) {

                    std::string_view statementKey = statement.substr(0, equality);
                    std::string_view statementValue = statement.substr(equality + 1);

                    /* String comparison */
                    if (key == statementKey) {

                        /* Decode value inplace, put null at end if before length of original */
                        char *in = (char *) statementValue.data();

                        /* Write offset */
                        unsigned int out = 0;

                        /* Walk over all chars until end or null char, decoding in place */
                        for (unsigned int i = 0; i < statementValue.length() && in[i]; i++) {
                                /* Only bother with '%' */
                                if (in[i] == '%') {
                                    /* Do we have enough data for two bytes hex? */
                                    if (i + 2 >= statementValue.length()) {
                                        return {};
                                    }

                                    /* Two bytes hex */
                                    int hex1 = in[i + 1] - '0';
                                    if (hex1 > 9) {
                                        hex1 &= 223;
                                        hex1 -= 7;
                                    }

                                    int hex2 = in[i + 2] - '0';
                                    if (hex2 > 9) {
                                        hex2 &= 223;
                                        hex2 -= 7;
                                    }

                                    *((unsigned char *) &in[out]) = (unsigned char) (hex1 * 16 + hex2);
                                    i += 2;
                                } else {
                                    /* Is this even a rule? */
                                    if (in[i] == '+') {
                                        in[out] = ' ';
                                    } else {
                                        in[out] = in[i];
                                    }
                                }

                                /* We always only write one char */
                                out++;
                        }

                        /* If decoded string is shorter than original, put null char to stop next read */
                        if (out < statementValue.length()) {
                            in[out] = 0;
                        }

                        return statementValue.substr(0, out);
                    }
                } else {
                    /* This querystring is invalid, cannot parse it */
                    return {nullptr, 0};
                }
            }

            queryString.remove_prefix(statement.length() + 1);
        }

        /* Nothing found is given as nullptr, while empty string is given as some pointer to the given buffer */
        return {nullptr, 0};
    }

}

#endif
