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

#ifndef UWS_ASYNCSOCKETDATA_H
#define UWS_ASYNCSOCKETDATA_H

#include <algorithm>
#include <cstdlib>
#include <cstring>

namespace uWS {

/* Contiguous write-behind buffer with a moving head cursor. erase() is a
 * pointer bump; append()/resize() reuse the drained head gap via one memmove
 * before ever growing. The previous std::string shape front-erased + shrank to
 * fit every ~1/32 drained, so a drain of N bytes moved ~60N bytes and briefly
 * held 2x the live data during each realloc. */
struct BackPressure {
    BackPressure() = default;
    BackPressure(BackPressure &&other) noexcept
        : buf(other.buf), head(other.head), tail(other.tail), cap(other.cap) {
        other.buf = nullptr;
        other.head = other.tail = other.cap = 0;
    }
    BackPressure(const BackPressure &) = delete;
    BackPressure &operator=(const BackPressure &) = delete;
    ~BackPressure() { std::free(buf); }

    /* Unsent bytes. data() points at length() contiguous bytes. */
    size_t length() const { return tail - head; }
    size_t size() const { return length(); }
    const char *data() const { return buf + head; }
    /* Allocation footprint for memoryCost / GC reporting. */
    size_t totalLength() const { return cap; }

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

    /* Make room for at least n live bytes without later realloc. */
    void reserve(size_t n) {
        if (n > length()) ensureTailRoom(n - length());
    }

    /* Grow to n live bytes; caller writes into data() + old length(). */
    void resize(size_t n) {
        size_t live = length();
        if (n > live) {
            ensureTailRoom(n - live);
            tail += n - live;
        } else {
            tail = head + n;
        }
    }

private:
    static constexpr size_t MIN_CAPACITY = 4096;

    char *buf = nullptr;
    size_t head = 0;
    size_t tail = 0;
    size_t cap = 0;

    /* Ensure [tail, tail+n) is writable. Prefers compacting into the drained
     * head gap over growing so steady-state producer/consumer never reallocs. */
    void ensureTailRoom(size_t n) {
        if (tail + n <= cap) return;

        size_t live = tail - head;
        if (head && live + n <= cap) {
            std::memmove(buf, buf + head, live);
            head = 0;
            tail = live;
            return;
        }

        size_t newCap = std::max(std::max(cap * 2, live + n), MIN_CAPACITY);
        char *nb;
        if (head == 0) {
            /* realloc may extend in place (mimalloc, glibc mremap). */
            nb = (char *) std::realloc(buf, newCap);
            if (!nb) std::abort();
        } else {
            nb = (char *) std::malloc(newCap);
            if (!nb) std::abort();
            if (live) std::memcpy(nb, buf + head, live);
            std::free(buf);
            head = 0;
            tail = live;
        }
        buf = nb;
        cap = newCap;
    }

    void release() {
        std::free(buf);
        buf = nullptr;
        cap = 0;
    }
};

/* Depending on how we want AsyncSocket to function, this will need to change */

template <bool SSL>
struct AsyncSocketData {
    /* This will do for now */
    BackPressure buffer;

    /* Allow move constructing us */
    AsyncSocketData(BackPressure &&backpressure) : buffer(std::move(backpressure)) {

    }

    /* Or empty */
    AsyncSocketData() = default;
    bool isIdle = false;
    bool isAuthorized = false; // per-socket TLS authorization status
};

}

#endif // UWS_ASYNCSOCKETDATA_H
