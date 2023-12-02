/* This is a fuzz test of the permessage-deflate module */

#define WIN32_EXPORT

#include <cstdio>
#include <string>
#include <bitset>

/* We test the permessage deflate module */
#include "../src/PerMessageDeflate.h"

#include "helpers.h"

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {

    /* First byte determines what compressor to use */
    if (size >= 1) {

        uWS::CompressOptions compressors[] = {
            uWS::DEDICATED_COMPRESSOR_3KB,
            uWS::DEDICATED_COMPRESSOR_4KB,
            uWS::DEDICATED_COMPRESSOR_8KB,
            uWS::DEDICATED_COMPRESSOR_16KB,
            uWS::DEDICATED_COMPRESSOR_32KB,
            uWS::DEDICATED_COMPRESSOR_64KB,
            uWS::DEDICATED_COMPRESSOR_128KB,
            uWS::DEDICATED_COMPRESSOR_256KB
        };

        auto compressor = compressors[data[0] % 8];
        data++;
        size--;

        /* Bits 0 - 256 are okay */
        std::bitset<257> b;

        /* If we could specify LARGE_BUFFER_SIZE small here we could force it to inflate in chunks,
        * triggering more line coverage. Currently it is set to 16kb which is always too much */
        struct StaticData {
            uWS::DeflationStream deflationStream;
            uWS::InflationStream inflationStream;
            uWS::ZlibContext zlibContext;
        } staticData = {compressor, compressor};

        /* Why is this padded? */
        makeChunked(makePadded(data, size), size, [&staticData, &b](const uint8_t *data, size_t size) {
            auto inflation = staticData.inflationStream.inflate(&staticData.zlibContext, std::string_view((char *) data, size), 256, true);

            /* Trigger ASAN flaws if length is more than 256 */
            if (inflation.has_value()) {
                b.set(inflation->length());
            }
        });

        makeChunked(makePadded(data, size), size, [&staticData](const uint8_t *data, size_t size) {
            /* Always reset */
            staticData.deflationStream.deflate(&staticData.zlibContext, std::string_view((char *) data, size), true);
        });

    }

    return 0;
}

