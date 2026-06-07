#pragma once

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
// clang-format off
#ifndef UWS_ASYNCSOCKET_H
#define UWS_ASYNCSOCKET_H

/* This class implements async socket memory management strategies */

/* NOTE: Many unsigned/signed conversion warnings could be solved by moving from int length
 * to unsigned length for everything to/from uSockets - this would however remove the opportunity
 * to signal error with -1 (which is how the entire UNIX syscalling is built). */

#include <cstring>
#include <iostream>

#include "libusockets.h"
#include "bun-usockets/src/internal/internal.h"



#include "LoopData.h"
#include "AsyncSocketData.h"

namespace uWS {

    enum SendBufferAttribute {
        NEEDS_NOTHING,
        NEEDS_DRAIN,
        NEEDS_UNCORK
    };

    template <bool, bool, typename> struct WebSocketContext;

template <bool SSL>
struct AsyncSocket {
    /* This guy is promiscuous */
    template <bool> friend struct HttpContext;
    template <bool, bool, typename> friend struct WebSocketContext;
    template <bool> friend struct TemplatedApp;
    template <bool, typename> friend struct WebSocketContextData;
    template <typename, typename> friend struct TopicTree;
    template <bool> friend struct HttpResponse;


public:
    /* Returns SSL pointer or FD as pointer */
    void *getNativeHandle() {
        return us_socket_get_native_handle((us_socket_t *) this);
    }

    /* Get loop data for socket */
    LoopData *getLoopData() {
        return (LoopData *) us_loop_ext(us_socket_group_loop(us_socket_group((us_socket_t *) this)));
    }

    /* Get socket extension */
    AsyncSocketData<SSL> *getAsyncSocketData() {
        return (AsyncSocketData<SSL> *) us_socket_ext((us_socket_t *) this);
    }

    /* Socket timeout */
    void timeout(unsigned int seconds) {
        us_socket_timeout((us_socket_t *) this, seconds);
    }

    /* Shutdown socket without any automatic drainage */
    void shutdown() {
        us_socket_shutdown((us_socket_t *) this);
    }

    /* Experimental pause */
    us_socket_t *pause() {
        us_socket_pause((us_socket_t *) this);
        return (us_socket_t *) this;
    }

    /* Experimental resume */
    us_socket_t *resume() {
        us_socket_resume((us_socket_t *) this);
        return (us_socket_t *) this;
    }

    /* Immediately close socket */
    us_socket_t *close() {
        this->uncork();
        return us_socket_close((us_socket_t *) this, 0, nullptr);
    }

    void uncorkWithoutSending() {
        /* Called from close/destroy paths. Removes this socket from any cork
         * slot to prevent the drain loop from dereferencing a freed pointer. */
        getLoopData()->unborrowCorkSlot(this);
    }

    /* Cork this socket. Two sockets may be corked per-loop at once. */
    void cork() {
        LoopData *loopData = getLoopData();

        /* Already corked? Nothing to do. */
        if (loopData->findCorkSlot(this) != LoopData::INVALID_CORK_SLOT) {
            return;
        }

        /* Grab a free slot. */
        if (loopData->acquireCorkSlot(this, SSL) != LoopData::INVALID_CORK_SLOT) {
            return;
        }

        /* Both slots hold data from other sockets. Force-uncork the least
         * recently used one to make room. */
        int victimSlot = loopData->getLRUCorkSlot();
        auto *vs = loopData->getCorkSlot(victimSlot);
        void *victim = vs->socket;
        bool victimSsl = vs->ssl;
        if (victimSsl) {
            ((AsyncSocket<true> *) victim)->uncork();
        } else {
            ((AsyncSocket<false> *) victim)->uncork();
        }
        loopData->acquireCorkSlot(this, SSL);
    }

    /* Returns whether we are corked */
    bool isCorked() {
        return getLoopData()->findCorkSlot(this) != LoopData::INVALID_CORK_SLOT;
    }

    /* Returns a suitable buffer for temporary assemblation of send data */
    std::pair<char *, SendBufferAttribute> getSendBuffer(size_t size) {
        LoopData *loopData = getLoopData();
        BackPressure &backPressure = getAsyncSocketData()->buffer;
        size_t existingBackpressure = backPressure.length();

        int slot = loopData->findCorkSlot(this);
        bool corked = slot != LoopData::INVALID_CORK_SLOT;
        unsigned int currentOffset = corked ? loopData->getCorkSlot(slot)->offset : 0;

        if ((!existingBackpressure) && (corked || loopData->canCork()) && (currentOffset + size <= LoopData::CORK_BUFFER_SIZE)) {
            if (!corked) {
                slot = loopData->acquireCorkSlot(this, SSL);
            }
            auto *s = loopData->getCorkSlot(slot);
            char *sendBuffer = s->buffer + s->offset;
            s->offset += (unsigned int) size;
            ASSERT(s->offset <= LoopData::CORK_BUFFER_SIZE);
            loopData->touchCorkSlot(slot);
            return {sendBuffer, corked ? SendBufferAttribute::NEEDS_NOTHING : SendBufferAttribute::NEEDS_UNCORK};
        } else {
            /* Fallback: move any corked data into the backpressure buffer. */
            unsigned int ourCorkOffset = 0;
            char *ourCorkBuffer = nullptr;
            if (corked) {
                auto *s = loopData->getCorkSlot(slot);
                ourCorkOffset = s->offset;
                ourCorkBuffer = s->buffer;
                s->offset = 0;
            }

            backPressure.resize(ourCorkOffset + existingBackpressure + size);

            if (ourCorkOffset > 0) {
                memcpy((char *) backPressure.data() + existingBackpressure, ourCorkBuffer, ourCorkOffset);
            }
            return {(char *) backPressure.data() + ourCorkOffset + existingBackpressure, SendBufferAttribute::NEEDS_DRAIN};
        }
    }

    /* Returns the user space backpressure. */
    size_t getBufferedAmount() {
        /* We return the actual amount of bytes in backbuffer, including pendingRemoval */
        return getAsyncSocketData()->buffer.totalLength();
    }

    /* Returns the text representation of an IPv4 or IPv6 address */
    std::string_view addressAsText(std::string_view binary) {
        static thread_local char buf[64];
        int ipLength = 0;

        if (!binary.length()) {
            return {};
        }

        unsigned char *b = (unsigned char *) binary.data();

        if (binary.length() == 4) {
            ipLength = snprintf(buf, sizeof(buf), "%u.%u.%u.%u", b[0], b[1], b[2], b[3]);
        } else {
            ipLength = snprintf(buf, sizeof(buf), "%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x:%02x%02x",
                b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11],
                b[12], b[13], b[14], b[15]);
        }

        return {buf, (unsigned int) ipLength};
    }

    /* Returns the remote IP address or empty string on failure */
    std::string_view getRemoteAddress() {
        static thread_local char buf[16];
        int ipLength = 16;
        us_socket_remote_address((us_socket_t *) this, buf, &ipLength);
        return std::string_view(buf, (unsigned int) ipLength);
    }

    /* Returns the text representation of IP */
    std::string_view getRemoteAddressAsText() {
        return addressAsText(getRemoteAddress());
    }

    /**
    * Flushes the socket buffer by writing as much data as possible to the underlying socket.
    *
    * @return The total number of bytes successfully written to the socket
    */
    size_t flush() {
        /* Check if socket is valid for operations */
        if (us_socket_is_closed((us_socket_t *) this)) {
            /* Socket is closed, no flushing is possible */
            return 0;
        }

        /* Get the associated asynchronous socket data structure */
        AsyncSocketData<SSL> *asyncSocketData = getAsyncSocketData();
        size_t total_written = 0;

        /* Continue flushing as long as we have data in the buffer */
        while (asyncSocketData->buffer.length()) {
            /* Get current buffer size */
            size_t buffer_len = asyncSocketData->buffer.length();

            /* Limit write size to INT_MAX as the underlying socket API uses int for length */
            int max_flush_len = std::min(buffer_len, (size_t)INT_MAX);

            /* Attempt to write data to the socket */
            int written = us_socket_write((us_socket_t *) this, asyncSocketData->buffer.data(), max_flush_len);
            total_written += written;

            /* Check if we couldn't write the entire buffer */
            if ((unsigned int) written < buffer_len) {
                /* Remove the successfully written data from the buffer */
                asyncSocketData->buffer.erase((unsigned int) written);

                /* If we wrote less than we attempted, the socket buffer is likely full
                * likely is used as an optimization hint to the compiler
                * since written < buffer_len is very likely to be true
                */
                if(written < max_flush_len) {
                    [[likely]]
                    /* Cannot write more at this time, return what we've written so far */
                    return total_written;
                }
                /* If we wrote exactly max_flush_len, we might be able to write more, so continue
                 * This is unlikely to happen, because this would be INT_MAX bytes, which is unlikely to be written in one go
                 * but we keep this check for completeness
                 */
                continue;
            }

            /* Successfully wrote the entire buffer, clear the buffer */
            asyncSocketData->buffer.clear();
        }

        /* Return the total number of bytes written during this flush operation */
        return total_written;
    }

    /* Write in three levels of prioritization: cork-buffer, syscall, socket-buffer. Always drain if possible.
     * Returns pair of bytes written (anywhere) and wheter or not this call resulted in the polling for
     * writable (or we are in a state that implies polling for writable). */
    std::pair<int, bool> write(const char *src, int length, bool optionally = false, int nextLength = 0) {
        /* Fake success if closed, simple fix to allow uncork of closed socket to succeed */
        if (us_socket_is_closed((us_socket_t *) this)) {
            return {length, false};
        }

        LoopData *loopData = getLoopData();
        AsyncSocketData<SSL> *asyncSocketData = getAsyncSocketData();
        /* We are limited if we have a per-socket buffer */
        if (asyncSocketData->buffer.length()) {
            size_t buffer_len = asyncSocketData->buffer.length();
            // we cannot not flush more than INT_MAX bytes at a time
            int max_flush_len = std::min(buffer_len, (size_t)INT_MAX);

            /* Write off as much as we can */
            int written = us_socket_write((us_socket_t *) this, asyncSocketData->buffer.data(), max_flush_len);
            /* On failure return, otherwise continue down the function */
            if ((unsigned int) written < buffer_len) {
                /* Update buffering (todo: we can do better here if we keep track of what happens to this guy later on) */
                asyncSocketData->buffer.erase((unsigned int) written);

                if (optionally) {
                    /* Thankfully we can exit early here */
                    return {0, true};
                } else {
                    /* This path is horrible and points towards erroneous usage */
                    asyncSocketData->buffer.append(src, (unsigned int) length);
                    return {length, true};
                }
            }

            /* At this point we simply have no buffer and can continue as normal */
            asyncSocketData->buffer.clear();
        }

        if (length) {
            int slot = loopData->findCorkSlot(this);
            if (slot != LoopData::INVALID_CORK_SLOT) {
                /* We are corked */
                auto *s = loopData->getCorkSlot(slot);
                if (LoopData::CORK_BUFFER_SIZE - s->offset >= (unsigned int) length) {
                    /* If the entire chunk fits in cork buffer */
                    memcpy(s->buffer + s->offset, src, (unsigned int) length);
                    s->offset += (unsigned int) length;
                    ASSERT(s->offset <= LoopData::CORK_BUFFER_SIZE);
                    loopData->touchCorkSlot(slot);
                    /* Fall through to default return */
                } else {
                    /* Chunk doesn't fit; flush cork + write the rest. */
                    return uncork(src, length, optionally);
                }
            } else {
                /* We are not corked */
                int written = us_socket_write((us_socket_t *) this, src, length);

                /* Did we fail? */
                if (written < length) {
                    /* If the write was optional then just bail out */
                    if (optionally) {
                        return {written, true};
                    }
                    /* Fall back to worst possible case (should be very rare for HTTP) */
                    /* At least we can reserve room for next chunk if we know it up front */
                    if (nextLength) {
                        asyncSocketData->buffer.reserve(asyncSocketData->buffer.length() + (size_t) (length - written + nextLength));
                    }

                    /* Buffer this chunk */
                    asyncSocketData->buffer.append(src + written, (size_t) (length - written));

                    /* Return the failure */
                    return {length, true};
                }
                /* Fall through to default return */
            }
        }

        /* Default fall through return */
        return {length, false};
    }

    /* Uncork this socket and flush or buffer any corked and/or passed data. It is essential to remember doing this. */
    /* It does NOT count bytes written from cork buffer (they are already accounted for in the write call responsible for its corking)! */
    std::pair<int, bool> uncork(const char *src = nullptr, int length = 0, bool optionally = false) {
        LoopData *loopData = getLoopData();

        int slot = loopData->findCorkSlot(this);
        if (slot == LoopData::INVALID_CORK_SLOT) {
            /* We are not even corked! */
            return {0, false};
        }

        auto *s = loopData->getCorkSlot(slot);
        unsigned int offset = s->offset;
        char *buffer = s->buffer;
        loopData->releaseCorkSlot(slot);

        if (offset) {
            /* Corked data is already accounted for via its write call */
            auto [written, failed] = write(buffer, (int) offset, false, length);

            if (failed && optionally) {
                /* We do not need to care for buffering here, write does that */
                return {0, true};
            }
            if (length == 0) {
                return {written, failed};
            }
        }

        /* We should only return with new writes, not things written to cork already */
        return write(src, length, optionally, 0);
    }
};

}

#endif // UWS_ASYNCSOCKET_H