
#include "bun-base64.h"

#if defined(__GNUC__) && defined(__ARM_NEON__)

int neon_base64_decode(char *out, const char *src, size_t srclen,
                       size_t *outlen);

#elif defined(__GNUC__) && (defined(__x86_64__) || defined(__i386__))

#include "fastavxbase64.h"

#endif

#if defined(__GNUC__) && defined(__ARM_NEON__)
size_t bun_base64_decode(char *dest, const char *src, size_t len,
                         size_t *outlen) {
  // neon base64 is decode only
  return neon_base64_decode(dest, src, len, outlen);
}
size_t bun_base64_encode(char *dest, const char *src, size_t len) {
  return chromium_base64_encode(dest, src, len);
}

#elif defined(__GNUC__) && (defined(__x86_64__) || defined(__i386__))

size_t bun_base64_decode(char *dest, const char *src, size_t len,
                         size_t *outlen) {
  return fast_avx2_base64_decode(dest, src, len, outlen);
}
size_t bun_base64_encode(char *dest, const char *src, size_t len) {

  return fast_avx2_base64_encode(dest, src, len);
}

#else

size_t bun_base64_decode(char *dest, const char *src, size_t len,
                         size_t *outlen) {
  return chromium_base64_decode(dest, src, len, outlen);
}
size_t bun_base64_encode(char *dest, const char *src, size_t len) {
  return chromium_base64_encode(dest, src, len);
}

#endif