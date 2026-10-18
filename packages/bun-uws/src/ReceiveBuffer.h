#ifndef UWS_RECEIVEBUFFER_H
#define UWS_RECEIVEBUFFER_H

#include "libusockets.h"

#include <algorithm>
#include <cstdint>
#include <cstring>

namespace uWS {

/* Contiguous buffer for bytes a peer sends. The peer decides its size, so every growth can be refused:
 * tryReserve() and tryAppend() then return false with the contents untouched. */
struct ReceiveBuffer {
    ReceiveBuffer() = default;
    ReceiveBuffer(const ReceiveBuffer &) = delete;
    ReceiveBuffer &operator=(const ReceiveBuffer &) = delete;
    ~ReceiveBuffer() { us_free(buf); }

    size_t length() const { return len; }
    char *data() { return buf; }

    /* Makes room for n bytes in total. */
    [[nodiscard]] bool tryReserve(size_t n) {
        if (n <= cap) return true;

        char *grown;
        if (len) {
            grown = (char *) us_realloc(buf, n);
        } else {
            /* Nothing to keep: a realloc that moves the block would copy its old bytes. */
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
        if (n > cap - len) {
            /* Doubles, so a message is copied a constant number of times. If cap * 2 wraps, len + n wins the max(). */
            if (n > SIZE_MAX - len || !tryReserve(std::max(len + n, cap * 2))) return false;
        }
        if (n) std::memcpy(buf + len, src, n);
        len += n;
        return true;
    }

    /* Keeps the first n bytes, and the allocation. */
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
    char *buf = nullptr;
    size_t len = 0;
    size_t cap = 0;
};

}

#endif // UWS_RECEIVEBUFFER_H
