#include "upstream/farmhash.h"
#include <emscripten/emscripten.h>

extern "C" EMSCRIPTEN_KEEPALIVE int32_t Fingerprint32(const char* buffer, int32_t bufLen) {
    return util::Fingerprint32(buffer, bufLen);
}

extern "C" EMSCRIPTEN_KEEPALIVE int64_t Fingerprint64(const char* buffer, int32_t bufLen) {
    return util::Fingerprint64(buffer, bufLen);
}
