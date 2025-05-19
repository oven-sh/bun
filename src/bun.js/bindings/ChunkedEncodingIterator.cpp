#include "root.h"
#include <bun-uws/src/ChunkedEncoding.h>

namespace Bun {

// We want:
// 1. Amount consumed
// 2. Chunk offset, chunk length
// 3. Success/fail
extern "C" ssize_t Bun__nextChunkInChunkedEncoding(const char** _Nonnull pdata, size_t* _Nonnull plen, uint64_t* _Nonnull pstate, int trailer, size_t* _Nonnull out_offset, size_t* _Nonnull out_length)
{
    const char* data = *pdata;
    size_t length = *plen;
    std::string_view view(data, length);

    // Use uws::getNextChunk to get the next chunk
    std::optional<std::string_view> chunk = uWS::getNextChunk(view, *pstate, !trailer);

    // Calculate how many bytes were consumed
    size_t consumed = length - view.size();

    // If a chunk was successfully retrieved
    if (chunk.has_value()) {
        std::string_view chunk_data = chunk.value();

        size_t chunk_length = chunk_data.length();

        // Update the caller's data pointer and length
        *pdata = (const char*)view.data();
        *plen = view.size();

        if (chunk_length == 0) {
            return -2; // EOF marker
        }

        // Calculate offset from the start of the input buffer
        size_t offset = chunk_data.data() - data;

        *out_offset = offset;
        *out_length = chunk_length;

        return consumed; // Return bytes consumed on success
    } else {
        // Check if we're in an invalid state
        if (uWS::isParsingInvalidChunkedEncoding(*pstate)) {
            return -1; // Error state
        }

        // Update the caller's data pointer and length even on failure
        *pdata = (const char*)view.data();
        *plen = view.size();

        // Return 0 for short read (need more data)
        return 0;
    }
}
}
