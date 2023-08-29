/* This is a fuzz test of the multipart parser */

#define WIN32_EXPORT

#include <cstdio>
#include <string>
#include <cstdlib>

#include "../src/Multipart.h"

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {

    if (!size) {
        return 0;
    }

    char *mutableMemory = (char *) malloc(size);
    memcpy(mutableMemory, data, size);

    /* First byte determines how long contentType is */
    unsigned char contentTypeLength = data[0];
    size--;

    std::string_view contentType((char *) mutableMemory + 1, std::min<size_t>(contentTypeLength, size));
    size -= contentType.length();

    std::string_view body((char *) mutableMemory + 1 + contentType.length(), size);

    uWS::MultipartParser mp(contentType);
    if (mp.isValid()) {
        mp.setBody(body);

        std::pair<std::string_view, std::string_view> headers[10];

        while (true) {
            std::optional<std::string_view> optionalPart = mp.getNextPart(headers);
            if (!optionalPart.has_value()) {
                break;
            }

            std::string_view part = optionalPart.value();

            for (int i = 0; headers[i].first.length(); i++) {
                /* We care about content-type and content-disposition */
                if (headers[i].first == "content-disposition") {
                    /* Parse the parameters */
                    uWS::ParameterParser pp(headers[i].second);
                    while (true) {
                        auto [key, value] = pp.getKeyValue();
                        if (!key.length()) {
                            break;
                        }
                    }
                }
            }
        }
    }

    free(mutableMemory);
    return 0;
}

