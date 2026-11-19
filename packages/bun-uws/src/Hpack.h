#ifndef UWS_HPACK_H
#define UWS_HPACK_H

// clang-format off

/* Owners for src/uws_sys/hpack.rs. */

#include "quic.h"

#include <cstddef>
#include <cstdint>
#include <memory>
#include <span>
#include <utility>

namespace uWS {

struct HeaderRef {
    uint32_t nameOff, nameLen, valueOff, valueLen;
};

namespace hpack {

struct State;
struct Buffer;

/* Of the decoded list. Decoding goes on past `size` and `fields`, and stops past the hard ones. */
struct Limits {
    size_t size, fields, hardSize, hardFields;
};

enum class Status : uint8_t { Complete, OverLimit, OverHardLimit, Malformed };

struct Decoded {
    const us_quic_header_t *fields;
    uint32_t count;
    Status status;
};

struct Encoded {
    const char *bytes;
    size_t length;
};

extern "C" State *Bun__Hpack__create();
extern "C" void Bun__Hpack__destroy(State *);
extern "C" Buffer *Bun__HpackBuffer__create();
extern "C" void Bun__HpackBuffer__destroy(Buffer *);
extern "C" void Bun__Hpack__setPeerTableSize(State *, uint32_t size);
extern "C" Decoded Bun__Hpack__decode(State *, Buffer *, const unsigned char *block, size_t length, const Limits *);
extern "C" Encoded Bun__Hpack__encode(State *, Buffer *, const char *bytes, size_t length, const HeaderRef *fields, size_t count, bool mayIndex);

struct Destroy {
    void operator()(State *state) const { Bun__Hpack__destroy(state); }
    void operator()(Buffer *buffer) const { Bun__HpackBuffer__destroy(buffer); }
};

}

/* What the result of a call points into, until the next call with it. */
class HpackBuffer {
    friend class Hpack;
    std::unique_ptr<hpack::Buffer, hpack::Destroy> buffer{hpack::Bun__HpackBuffer__create()};
};

/* Both directions of one connection. */
class Hpack {
    std::unique_ptr<hpack::State, hpack::Destroy> state{hpack::Bun__Hpack__create()};

public:
    using Status = hpack::Status;
    enum class Indexing : bool { Without, Allowed };

    void setPeerTableSize(uint32_t size) { hpack::Bun__Hpack__setPeerTableSize(state.get(), size); }

    /* The list is empty unless Complete. `qpack_index` is the HPACK static-table index the peer used for the name, or 0. */
    std::pair<std::span<const us_quic_header_t>, Status> decode(HpackBuffer &to, std::span<const unsigned char> block, const hpack::Limits &limits) {
        hpack::Decoded decoded = hpack::Bun__Hpack__decode(state.get(), to.buffer.get(), block.data(), block.size(), &limits);
        return {{decoded.fields, decoded.count}, decoded.status};
    }

    /* The peer has to get every block, in order. */
    std::span<const char> encode(HpackBuffer &to, std::span<const char> bytes, std::span<const HeaderRef> fields, Indexing indexing) {
        hpack::Encoded encoded = hpack::Bun__Hpack__encode(state.get(), to.buffer.get(), bytes.data(), bytes.size(), fields.data(), fields.size(), indexing == Indexing::Allowed);
        return {encoded.bytes, encoded.length};
    }
};

}

#endif
