#pragma once
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

#ifndef UWS_BACKPRESSURE_H
#define UWS_BACKPRESSURE_H

#include "libusockets.h"

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace uWS {

/* Contiguous buffer with a moving head cursor: erase() bumps head,
 * append() compacts into the drained head gap before growing, so
 * draining never memmoves or reallocates. Growing reserves TAIL_ROOM spare
 * bytes, so appending framing after a buffered payload doesn't reallocate and
 * copy that payload. */
struct BackPressure {
    BackPressure() = default;
    BackPressure(const BackPressure &) = delete;
    BackPressure &operator=(const BackPressure &) = delete;
    ~BackPressure() { us_free(buf); }

    /* Unsent bytes. data() points at length() contiguous bytes. */
    size_t length() const { return tail - head; }
    const char *data() const { return buf + head; }

    void append(const char *src, size_t n) {
        if (!n) return;
        ensureTailRoom(n);
        std::memcpy(buf + tail, src, n);
        tail += n;
    }

    void erase(size_t n) {
        head += n;
        if (head >= tail) {
            /* Fully drained: next append writes at offset 0 with no memmove. */
            head = tail = 0;
            release();
        }
    }

    void clear() {
        head = tail = 0;
        release();
    }

private:
    static constexpr size_t TAIL_ROOM = 12;
    static constexpr size_t MIN_CAPACITY = 4096;

    char *buf = nullptr;
    size_t head = 0;
    size_t tail = 0;
    size_t cap = 0;

    /* Ensure [tail, tail+n) is writable. Prefers compacting into the drained
     * head gap over growing so steady-state producer/consumer never reallocs. */
    void ensureTailRoom(size_t n) {
        /* tail + n and live + n cannot wrap past this; cap * 2 wrapping is
         * harmless because live + n then wins the max(). */
        if (n > SIZE_MAX - tail) std::abort();
        if (tail + n <= cap) return;

        size_t live = tail - head;
        if (head && live + n <= cap) {
            std::memmove(buf, buf + head, live);
            head = 0;
            tail = live;
            return;
        }

        if (live + n > SIZE_MAX - TAIL_ROOM) std::abort();
        size_t newCap = std::max(std::max(cap * 2, live + n + TAIL_ROOM), MIN_CAPACITY);
        char *nb;
        if (head == 0) {
            /* mi_realloc may extend in place. */
            nb = (char *) us_realloc(buf, newCap);
            if (!nb) std::abort();
        } else {
            nb = (char *) us_malloc(newCap);
            if (!nb) std::abort();
            if (live) std::memcpy(nb, buf + head, live);
            us_free(buf);
            head = 0;
            tail = live;
        }
        buf = nb;
        cap = newCap;
    }

    void release() {
        us_free(buf);
        buf = nullptr;
        cap = 0;
    }
};

}

#endif // UWS_BACKPRESSURE_H
