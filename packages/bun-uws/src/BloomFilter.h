/*
 * Authored by Alex Hultman, 2018-2022.
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

#ifndef UWS_BLOOMFILTER_H
#define UWS_BLOOMFILTER_H

/* This filter has no false positives or collisions for the standard
 * and non-standard common request headers */

#include <string_view>
#include <bitset>

namespace uWS {

struct BloomFilter {
private:
    std::bitset<256> filter;
    static inline uint32_t perfectHash(uint32_t features) {
        return features *= 1843993368;
    }

    union ScrambleArea {
        unsigned char p[4];
        uint32_t val;
    };

    ScrambleArea getFeatures(std::string_view key) {
        ScrambleArea s;
        s.p[0] = reinterpret_cast<const unsigned char&>(key[0]);
        s.p[1] = reinterpret_cast<const unsigned char&>(key[key.length() - 1]);
        s.p[2] = reinterpret_cast<const unsigned char&>(key[key.length() - 2]);
        s.p[3] = reinterpret_cast<const unsigned char&>(key[key.length() >> 1]);
        return s;
    }

public:
    bool mightHave(std::string_view key) {
        if (key.length() < 2) {
            return true;
        }

        ScrambleArea s = getFeatures(key);
        s.val = perfectHash(s.val);
        return filter[s.p[0]] &&
        filter[s.p[1]] &&
        filter[s.p[2]] &&
        filter[s.p[3]];
    }

    void add(std::string_view key) {
        if (key.length() >= 2) {
            ScrambleArea s = getFeatures(key);
            s.val = perfectHash(s.val);
            filter[s.p[0]] = 1;
            filter[s.p[1]] = 1;
            filter[s.p[2]] = 1;
            filter[s.p[3]] = 1;
        }
    }

    void reset() {
        filter.reset();
    }
};

}

#endif // UWS_BLOOMFILTER_H
