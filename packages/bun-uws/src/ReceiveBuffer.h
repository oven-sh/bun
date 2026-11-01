#ifndef UWS_RECEIVEBUFFER_H
#define UWS_RECEIVEBUFFER_H

#include "libusockets.h"

#include <algorithm>
#include <cstdint>
#include <cstring>

namespace uWS {

/* Contiguous buffer for bytes received from a peer. The peer controls the size, so tryReserve() and
 * tryAppend() return false if allocation fails, without changing the contents. */
struct ReceiveBuffer {
    ReceiveBuffer() = default;
    ReceiveBuffer(const ReceiveBuffer &) = delete;
    ReceiveBuffer &operator=(const ReceiveBuffer &) = delete;
    ~ReceiveBuffer() { us_free(buf); }

    size_t length() const { return len; }
    char *data() { return buf; }

    /* Grows the capacity to at least n bytes. */
    [[nodiscard]] bool tryReserve(size_t n) {
        if (n <= cap) return true;

        char *grown;
        if (len) {
            grown = (char *) us_realloc(buf, n);
        } else {
            /* The buffer is empty, so skip realloc, which could copy the stale bytes. */
            us_free(buf);
            buf = nullptr;
            cap = 0;
            grown = (char *) us_malloc(n);
        }
        if (!grown) return false;

        buf = grown;
        cap = n;
        return true;
    }

    [[nodiscard]] bool tryAppend(const char *src, size_t n) {
        if (n > cap - len && !tryGrow(n)) return false;
        if (n) std::memcpy(buf + len, src, n);
        len += n;
        return true;
    }

    /* Shrinks the length to n bytes without freeing the allocation. */
    void truncate(size_t n) { len = n; }

    /* Empties the buffer and keeps the allocation for the next message. */
    void clear() { len = 0; }

    /* Empties the buffer and frees the allocation. */
    void release() {
        us_free(buf);
        buf = nullptr;
        len = cap = 0;
    }

private:
    /* Makes room for n more bytes. Doubles the capacity so appends are amortized O(1), and falls back to the
     * exact size if the doubled allocation fails. */
    __attribute__((noinline)) bool tryGrow(size_t n) {
        if (n > SIZE_MAX - len) return false;
        size_t exact = len + n;
        /* If cap * 2 overflows, max() picks exact. */
        size_t doubled = std::max(exact, cap * 2);
        return tryReserve(doubled) || (doubled != exact && tryReserve(exact));
    }

    char *buf = nullptr;
    size_t len = 0;
    size_t cap = 0;
};

}

#endif // UWS_RECEIVEBUFFER_H
