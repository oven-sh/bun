
#include "chromiumbase64.h"
#include "fastavxbase64.h"

size_t bun_base64_decode(char *dest, const char *src, size_t len,
                         size_t *outlen);
size_t bun_base64_encode(char *dest, const char *str, size_t len);