#include "../src/QueryParser.h"

#include <string>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {

    std::string modifiableInput((char *) data, size);

    uWS::getDecodedQueryValue("", modifiableInput);
    uWS::getDecodedQueryValue("hello", modifiableInput);

    return 0;
}