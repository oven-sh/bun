#include <iostream>
#include <cassert>
#include <sstream>
#include <iomanip>
#include <vector>
#include <climits>

#include "../src/ChunkedEncoding.h"

void consumeChunkEncoding(int maxConsume, std::string_view &chunkEncoded, uint64_t &state) {
    //int maxConsume = 200;

    if (uWS::isParsingChunkedEncoding(state)) {
        std::cout << "already in chunked parsing state!" << std::endl;
        std::abort();
    }

    // this should not break the parser
    state = uWS::STATE_IS_CHUNKED;

    while (chunkEncoded.length()) {

        /* Split up the chunkEncoded string into further chunks for parsing */
        std::string_view data = chunkEncoded.substr(0, std::min<size_t>(maxConsume, chunkEncoded.length()));
        unsigned int data_length_before_parsing = data.length();

        for (auto chunk : uWS::ChunkIterator(&data, &state, true)) {
        }

        /* Only remove that which was consumed */
        chunkEncoded.remove_prefix(data_length_before_parsing - data.length());

        if (state == 0) {

            if (chunkEncoded.length() == 0 || chunkEncoded.length() == 74) {
                break;
            } else {
                std::abort();
            }

            // should be fine
            state = uWS::STATE_IS_CHUNKED;

            //std::cout << "remaining chunk:" << chunkEncoded.length() << std::endl;
            //std::abort();
            //break;
        }

        /* Here we must be in parsingchunked state */
        if (!uWS::isParsingChunkedEncoding(state)) {
            std::cout << "not in parsing chunked strate!" << std::endl;
            std::abort();
        }

    }
}

void runBetterTest(unsigned int maxConsume) {
    /* A list of chunks */
    std::vector<std::string_view> chunks = {
        "Hello there I am the first segment",
        "Why hello there",
        "",
        "I am last?",
        "And I am a little longer but it doesn't matter",
        ""
    };

    /* Encode them in chunked encoding */
    std::stringstream ss;
    for (std::string_view chunk : chunks) {
        /* Generic chunked encoding format */
        ss << std::hex << chunk.length() << "\r\n" << chunk << "\r\n";

        /* Every null chunk is followed by an empty trailer */
        if (chunk.length() == 0) {
            ss << "\r\n";
        }
    }
    std::string buffer = ss.str();
    std::string_view chunkEncoded = buffer;

    uint64_t state = 0;

    if (uWS::isParsingChunkedEncoding(state)) {
        std::abort();
    }
    consumeChunkEncoding(maxConsume, chunkEncoded, state);
    if (state != 0) {
        std::abort();
    }
    consumeChunkEncoding(maxConsume, chunkEncoded, state);
    if (state != 0) {
        std::abort();
    }

    // consumeChunkEncoding(chunkEncoded) - consumes in further chunkes and does isParsingChunked checks
    // assume state == 0 and we still have bytes to parse (we should have consumed EXACTLY right bytes)
    // consumeChunkEncoding(chunkEncoded)
    // assume state == 0 and we have no bytes to consume
}

void runTest(unsigned int maxConsume) {
    /* A list of chunks */
    std::vector<std::string_view> chunks = {
        "Hello there I am the first segment",
        "Why hello there",
        "",
        "I am last?",
        "And I am a little longer but it doesn't matter",
        ""
    };

    /* Encode them in chunked encoding */
    std::stringstream ss;
    for (std::string_view chunk : chunks) {
        /* Generic chunked encoding format */
        ss << std::hex << chunk.length() << "\r\n" << chunk << "\r\n";

        /* Every null chunk is followed by an empty trailer */
        if (chunk.length() == 0) {
            ss << "\r\n";
        }
    }
    std::string buffer = ss.str();

    /* Since we have 2 chunked bodies in our buffer, the parser must stop with state == 0 exactly 2 times */
    unsigned int stoppedWithClearState = 0;
    
    /* Begin with a clear state and the full data */
    uint64_t state = 0;
    unsigned int chunkOffset = 0;
    std::string_view chunkEncoded = buffer;

    // consumeChunkEncoding(chunkEncoded) - consumes in further chunkes and does isParsingChunked checks
    // assume state == 0 and we still have bytes to parse (we should have consumed EXACTLY right bytes)
    // consumeChunkEncoding(chunkEncoded)
    // assume state == 0 and we have no bytes to consume

    // this while should be more like if original size or "is parsing chunked" (which tests the uWS::wantsChunkedParsing(state))
    while (chunkEncoded.length()) {
        /* Parse a small part of the given data */
        std::string_view data = chunkEncoded.substr(0, std::min<size_t>(maxConsume, chunkEncoded.length()));
        

        unsigned int data_length_before_parsing = data.length();
        

        /* Whatever chunk we emit, or part of chunk, it must match the expected one */
        //std::cout << "Calling parser now" << std::endl;
        for (auto chunk : uWS::ChunkIterator(&data, &state, true)) {
            std::cout << "<" << chunk << ">" << std::endl;

            /* Run check here */
            if (!chunk.length() && chunks[chunkOffset].length()) {
                std::cout << "We got emitted an empty chunk but expected a non-empty one" << std::endl;
                std::abort();
            }

            if (chunks[chunkOffset].substr(0, chunk.length()) == chunk /*starts_with(chunk)*/) {
                chunks[chunkOffset].remove_prefix(chunk.length());
                if (!chunks[chunkOffset].length()) {
                    chunkOffset++;
                }
            } else {
                std::cerr << "Chunk does not match! Should be <" << chunks[chunkOffset] << ">" << std::endl;
                std::abort();                
            }
        }

        /* The parser returtned, okay count the times it has state == 0, it should be 2 per the whole buffer always */
        if (state == 0) {
            printf("Parser stopped with no state set!\n");
            stoppedWithClearState++;
        }

        /* Only remove that which was consumed */
        chunkEncoded.remove_prefix(data_length_before_parsing - data.length());
    }

    if (stoppedWithClearState != 2) {
        std::cerr << "Error: The parser stopped with no state " << stoppedWithClearState << " times!" << std::endl;
        std::abort();
    }
}

void testWithoutTrailer() {
    /* A list of chunks */
    std::vector<std::string_view> chunks = {
        "Hello there I am the first segment",
        ""
    };

    /* Encode them in chunked encoding */
    std::stringstream ss;
    for (std::string_view chunk : chunks) {
        /* Generic chunked encoding format */
        ss << std::hex << chunk.length() << "\r\n" << chunk << "\r\n";
    }
    std::string buffer = ss.str();
    std::string_view dataToConsume(buffer.data(), buffer.length());

    uint64_t state = uWS::STATE_IS_CHUNKED;

    for (auto chunk : uWS::ChunkIterator(&dataToConsume, &state)) {

    }

    if (state) {
        std::abort();
    }
}

int main() {

    testWithoutTrailer();

    for (int i = 1; i < 1000; i++) {
        runBetterTest(i);
    }

    for (int i = 1; i < 1000; i++) {
        runTest(i);
    }

    std::cout << "ALL BRUTEFORCE DONE" << std::endl;
}