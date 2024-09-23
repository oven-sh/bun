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

#ifndef UWS_WEBSOCKETPROTOCOL_H
#define UWS_WEBSOCKETPROTOCOL_H

#include <libusockets.h>

#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <string_view>

// bun-specific
#include "wtf/SIMDUTF.h"

namespace uWS {

/* We should not overcomplicate these */
const std::string_view ERR_TOO_BIG_MESSAGE("Received too big message");
const std::string_view ERR_WEBSOCKET_TIMEOUT("WebSocket timed out from inactivity");
const std::string_view ERR_INVALID_TEXT("Received invalid UTF-8");
const std::string_view ERR_TOO_BIG_MESSAGE_INFLATION("Received too big message, or other inflation error");
const std::string_view ERR_INVALID_CLOSE_PAYLOAD("Received invalid close payload");

enum OpCode : unsigned char {
    CONTINUATION = 0,
    TEXT = 1,
    BINARY = 2,
    CLOSE = 8,
    PING = 9,
    PONG = 10
};

enum {
    CLIENT,
    SERVER
};

// 24 bytes perfectly
template <bool isServer>
struct WebSocketState {
public:
    static const unsigned int SHORT_MESSAGE_HEADER = isServer ? 6 : 2;
    static const unsigned int MEDIUM_MESSAGE_HEADER = isServer ? 8 : 4;
    static const unsigned int LONG_MESSAGE_HEADER = isServer ? 14 : 10;

    // 16 bytes
    struct State {
        unsigned int wantsHead : 1;
        unsigned int spillLength : 4;
        signed int opStack : 2; // -1, 0, 1
        unsigned int lastFin : 1;

        // 15 bytes
        unsigned char spill[LONG_MESSAGE_HEADER - 1];
        OpCode opCode[2];

        State() {
            wantsHead = true;
            spillLength = 0;
            opStack = -1;
            lastFin = true;
        }

    } state;

    // 8 bytes
    unsigned int remainingBytes = 0;
    char mask[isServer ? 4 : 1];
};

namespace protocol {

template <typename T>
T bit_cast(char *c) {
    T val;
    memcpy(&val, c, sizeof(T));
    return val;
}

/* Byte swap for little-endian systems */
template <typename T>
T cond_byte_swap(T value) {
    uint32_t endian_test = 1;
    if (*((char *)&endian_test)) {
        union {
            T i;
            uint8_t b[sizeof(T)];
        } src = { value }, dst;

        for (unsigned int i = 0; i < sizeof(value); i++) {
            dst.b[i] = src.b[sizeof(value) - 1 - i];
        }

        return dst.i;
    }
    return value;
}

static bool isValidUtf8(unsigned char *s, size_t length)
{
    return simdutf::validate_utf8(reinterpret_cast<const char *>(s), length);
}

struct CloseFrame {
    uint16_t code;
    char *message;
    size_t length;
};

static inline CloseFrame parseClosePayload(char *src, size_t length) {
    /* If we get no code or message, default to reporting 1005 no status code present */
    CloseFrame cf = {1005, nullptr, 0};
    if (length >= 2) {
        memcpy(&cf.code, src, 2);
        cf = {cond_byte_swap<uint16_t>(cf.code), src + 2, length - 2};
        if (cf.code < 1000 || cf.code > 4999 || (cf.code > 1011 && cf.code < 4000) ||
            (cf.code >= 1004 && cf.code <= 1006) || !isValidUtf8((unsigned char *) cf.message, cf.length)) {
            /* Even though we got a WebSocket close frame, it in itself is abnormal */
            return {1006, nullptr, 0};
        }
    }
    return cf;
}

static inline size_t formatClosePayload(char *dst, uint16_t code, const char *message, size_t length) {
    /* We could have more strict checks here, but never append code 0 or 1005 or 1006 */
    if (code && code != 1005 && code != 1006) {
        code = cond_byte_swap<uint16_t>(code);
        memcpy(dst, &code, 2);
        /* It is invalid to pass nullptr to memcpy, even though length is 0 */
        if (message) {
            memcpy(dst + 2, message, length);
        }
        return length + 2;
    }
    return 0;
}

static inline size_t messageFrameSize(size_t messageSize) {
    if (messageSize < 126) {
        return 2 + messageSize;
    } else if (messageSize <= UINT16_MAX) {
        return 4 + messageSize;
    }
    return 10 + messageSize;
}

enum {
    SND_CONTINUATION = 1,
    SND_NO_FIN = 2,
    SND_COMPRESSED = 64
};

template <bool isServer>
static inline size_t formatMessage(char *dst, const char *src, size_t length, OpCode opCode, size_t reportedLength, bool compressed, bool fin) {
    size_t messageLength;
    size_t headerLength;
    if (reportedLength < 126) {
        headerLength = 2;
        dst[1] = (char) reportedLength;
    } else if (reportedLength <= UINT16_MAX) {
        headerLength = 4;
        dst[1] = 126;
        uint16_t tmp = cond_byte_swap<uint16_t>((uint16_t) reportedLength);
        memcpy(&dst[2], &tmp, sizeof(uint16_t));
    } else {
        headerLength = 10;
        dst[1] = 127;
        uint64_t tmp = cond_byte_swap<uint64_t>((uint64_t) reportedLength);
        memcpy(&dst[2], &tmp, sizeof(uint64_t));
    }

    dst[0] = (char) ((fin ? 128 : 0) | ((compressed && opCode) ? SND_COMPRESSED : 0) | (char) opCode);

    //printf("%d\n", (int)dst[0]);

    char mask[4];
    if (!isServer) {
        dst[1] |= 0x80;
        uint32_t random = (uint32_t) rand();
        memcpy(mask, &random, 4);
        memcpy(dst + headerLength, &random, 4);
        headerLength += 4;
    }

    messageLength = headerLength + length;
    memcpy(dst + headerLength, src, length);

    if (!isServer) {

        // overwrites up to 3 bytes outside of the given buffer!
        //WebSocketProtocol<isServer>::unmaskInplace(dst + headerLength, dst + headerLength + length, mask);

        // this is not optimal
        char *start = dst + headerLength;
        char *stop = start + length;
        int i = 0;
        while (start != stop) {
            (*start++) ^= mask[i++ % 4];
        }
    }
    return messageLength;
}

}

// essentially this is only a parser
template <const bool isServer, typename Impl>
struct WebSocketProtocol {
public:
    static const unsigned int SHORT_MESSAGE_HEADER = isServer ? 6 : 2;
    static const unsigned int MEDIUM_MESSAGE_HEADER = isServer ? 8 : 4;
    static const unsigned int LONG_MESSAGE_HEADER = isServer ? 14 : 10;

protected:
    static inline bool isFin(char *frame) {return *((unsigned char *) frame) & 128;}
    static inline unsigned char getOpCode(char *frame) {return *((unsigned char *) frame) & 15;}
    static inline unsigned char payloadLength(char *frame) {return ((unsigned char *) frame)[1] & 127;}
    static inline bool rsv23(char *frame) {return *((unsigned char *) frame) & 48;}
    static inline bool rsv1(char *frame) {return *((unsigned char *) frame) & 64;}

    template <int N>
    static inline void UnrolledXor(char * __restrict data, char * __restrict mask) {
        if constexpr (N != 1) {
            UnrolledXor<N - 1>(data, mask);
        }
        data[N - 1] ^= mask[(N - 1) % 4];
    }

    static inline void unmaskImprecise(char *dst, char *src, char *mask, unsigned int length) {
        for (unsigned int n = (length >> 2) + 1; n; n--) {
            *(dst++) = *(src++) ^ mask[0];
            *(dst++) = *(src++) ^ mask[1];
            *(dst++) = *(src++) ^ mask[2];
            *(dst++) = *(src++) ^ mask[3];
        }
    }

    static inline void unmaskImpreciseCopyMask(char *src, unsigned int length) {
        char mask[4] = {src[-4], src[-3], src[-2], src[-1]};
        unmaskImprecise(src-4, src, mask, length);
    }

    static inline void rotateMask(unsigned int offset, char *mask) {
        char originalMask[4] = {mask[0], mask[1], mask[2], mask[3]};
        mask[(0 + offset) % 4] = originalMask[0];
        mask[(1 + offset) % 4] = originalMask[1];
        mask[(2 + offset) % 4] = originalMask[2];
        mask[(3 + offset) % 4] = originalMask[3];
    }

    static inline void unmaskInplace(char *data, char *stop, char *mask) {
        while (data < stop) {
            *(data++) ^= mask[0];
            *(data++) ^= mask[1];
            *(data++) ^= mask[2];
            *(data++) ^= mask[3];
        }
    }

    template <unsigned int MESSAGE_HEADER, typename T>
    static inline bool consumeMessage(T payLength, char *&src, unsigned int &length, WebSocketState<isServer> *wState, void *user) {
        if (getOpCode(src)) {
            if (wState->state.opStack == 1 || (!wState->state.lastFin && getOpCode(src) < 2)) {
                Impl::forceClose(wState, user);
                return true;
            }
            wState->state.opCode[++wState->state.opStack] = (OpCode) getOpCode(src);
        } else if (wState->state.opStack == -1) {
            Impl::forceClose(wState, user);
            return true;
        }
        wState->state.lastFin = isFin(src);

        if (Impl::refusePayloadLength(payLength, wState, user)) {
            Impl::forceClose(wState, user, ERR_TOO_BIG_MESSAGE);
            return true;
        }

        if (payLength + MESSAGE_HEADER <= length) {
            if (isServer) {
                unmaskImpreciseCopyMask(src + MESSAGE_HEADER, (unsigned int) payLength);
                if (Impl::handleFragment(src + MESSAGE_HEADER - 4, payLength, 0, wState->state.opCode[wState->state.opStack], isFin(src), wState, user)) {
                    return true;
                }
            } else {
                if (Impl::handleFragment(src + MESSAGE_HEADER, payLength, 0, wState->state.opCode[wState->state.opStack], isFin(src), wState, user)) {
                    return true;
                }
            }

            if (isFin(src)) {
                wState->state.opStack--;
            }

            src += payLength + MESSAGE_HEADER;
            length -= (unsigned int) (payLength + MESSAGE_HEADER);
            wState->state.spillLength = 0;
            return false;
        } else {
            wState->state.spillLength = 0;
            wState->state.wantsHead = false;
            wState->remainingBytes = (unsigned int) (payLength - length + MESSAGE_HEADER);
            bool fin = isFin(src);
            if (isServer) {
                memcpy(wState->mask, src + MESSAGE_HEADER - 4, 4);
                unmaskImprecise(src, src + MESSAGE_HEADER, wState->mask, length - MESSAGE_HEADER);
                rotateMask(4 - (length - MESSAGE_HEADER) % 4, wState->mask);
            } else {
                src += MESSAGE_HEADER;
            }
            Impl::handleFragment(src, length - MESSAGE_HEADER, wState->remainingBytes, wState->state.opCode[wState->state.opStack], fin, wState, user);
            return true;
        }
    }

    /* This one is nicely vectorized on both ARM64 and X64 - especially with -mavx */
    static inline void unmaskAll(char * __restrict data, char * __restrict mask) {
        for (int i = 0; i < LIBUS_RECV_BUFFER_LENGTH; i += 16) {
            UnrolledXor<16>(data + i, mask);
        }
    }

    static inline bool consumeContinuation(char *&src, unsigned int &length, WebSocketState<isServer> *wState, void *user) {
        if (wState->remainingBytes <= length) {
            if (isServer) {
                unsigned int n = wState->remainingBytes >> 2;
                unmaskInplace(src, src + n * 4, wState->mask);
                for (unsigned int i = 0, s = wState->remainingBytes % 4; i < s; i++) {
                    src[n * 4 + i] ^= wState->mask[i];
                }
            }

            if (Impl::handleFragment(src, wState->remainingBytes, 0, wState->state.opCode[wState->state.opStack], wState->state.lastFin, wState, user)) {
                return false;
            }

            if (wState->state.lastFin) {
                wState->state.opStack--;
            }

            src += wState->remainingBytes;
            length -= wState->remainingBytes;
            wState->state.wantsHead = true;
            return true;
        } else {
            if (isServer) {
                /* No need to unmask if mask is 0 */
                uint32_t nullmask = 0;
                if (memcmp(wState->mask, &nullmask, sizeof(uint32_t))) {
                    if /*constexpr*/ (LIBUS_RECV_BUFFER_LENGTH == length) {
                        unmaskAll(src, wState->mask);
                    } else {
                        // Slow path
                        unmaskInplace(src, src + ((length >> 2) + 1) * 4, wState->mask);
                    }
                }
            }

            wState->remainingBytes -= length;
            if (Impl::handleFragment(src, length, wState->remainingBytes, wState->state.opCode[wState->state.opStack], wState->state.lastFin, wState, user)) {
                return false;
            }

            if (isServer && length % 4) {
                rotateMask(4 - (length % 4), wState->mask);
            }
            return false;
        }
    }

public:
    WebSocketProtocol() {

    }

    static inline void consume(char *src, unsigned int length, WebSocketState<isServer> *wState, void *user) {
        if (wState->state.spillLength) {
            src -= wState->state.spillLength;
            length += wState->state.spillLength;
            memcpy(src, wState->state.spill, wState->state.spillLength);
        }
        if (wState->state.wantsHead) {
            parseNext:
            while (length >= SHORT_MESSAGE_HEADER) {

                // invalid reserved bits / invalid opcodes / invalid control frames / set compressed frame
                if ((rsv1(src) && !Impl::setCompressed(wState, user)) || rsv23(src) || (getOpCode(src) > 2 && getOpCode(src) < 8) ||
                    getOpCode(src) > 10 || (getOpCode(src) > 2 && (!isFin(src) || payloadLength(src) > 125))) {
                    Impl::forceClose(wState, user);
                    return;
                }

                if (payloadLength(src) < 126) {
                    if (consumeMessage<SHORT_MESSAGE_HEADER, uint8_t>(payloadLength(src), src, length, wState, user)) {
                        return;
                    }
                } else if (payloadLength(src) == 126) {
                    if (length < MEDIUM_MESSAGE_HEADER) {
                        break;
                    } else if(consumeMessage<MEDIUM_MESSAGE_HEADER, uint16_t>(protocol::cond_byte_swap<uint16_t>(protocol::bit_cast<uint16_t>(src + 2)), src, length, wState, user)) {
                        return;
                    }
                } else if (length < LONG_MESSAGE_HEADER) {
                    break;
                } else if (consumeMessage<LONG_MESSAGE_HEADER, uint64_t>(protocol::cond_byte_swap<uint64_t>(protocol::bit_cast<uint64_t>(src + 2)), src, length, wState, user)) {
                    return;
                }
            }
            if (length) {
                memcpy(wState->state.spill, src, length);
                wState->state.spillLength = length & 0xf;
            }
        } else if (consumeContinuation(src, length, wState, user)) {
            goto parseNext;
        }
    }

    static const int CONSUME_POST_PADDING = 4;
    static const int CONSUME_PRE_PADDING = LONG_MESSAGE_HEADER - 1;
};

}

#endif // UWS_WEBSOCKETPROTOCOL_H
