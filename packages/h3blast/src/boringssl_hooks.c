// The embedder hooks that Bun's BoringSSL objects call.
//
// scripts/build/deps/boringssl.ts compiles BoringSSL with defines that turn the
// functions below into undefined symbols (boringsslEmbedderHooks). The bun
// binary gets them from src/boringssl/lib.rs (mimalloc) and
// src/simdutf_sys/bun-simdutf.cpp (simdutf). h3blast links the same objects
// without either, so it has libc-backed ones. The build compiles this file with
// the same defines, so each block below exists exactly when BoringSSL calls it.
// A define added there needs a block here.

#define _GNU_SOURCE
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#if defined(BORINGSSL_REQUIRE_MEMORY_HOOKS)
// crypto/mem.cc: these back OPENSSL_malloc and OPENSSL_free. The free hook
// zeroes the block itself and never gets NULL.
//
// The size BoringSSL asked for is kept in a header in front of the block, as
// mem.cc does without the hooks. malloc_usable_size() reports more than that,
// and to write the difference is a buffer overflow to _FORTIFY_SOURCE.
enum { header_size = _Alignof(max_align_t) };
_Static_assert(header_size >= sizeof(size_t), "the header holds the size");

void *OPENSSL_memory_alloc(size_t size) {
    if (size > SIZE_MAX - header_size) return NULL;
    size_t *block = malloc(header_size + size);
    if (block == NULL) return NULL;
    *block = size;
    return (char *)block + header_size;
}

size_t OPENSSL_memory_get_size(void *ptr) { return *(size_t *)((char *)ptr - header_size); }

void OPENSSL_memory_free(void *ptr) {
    size_t *block = (size_t *)((char *)ptr - header_size);
    explicit_bzero(block, header_size + *block);
    free(block);
}

// crypto/internal.h: these back the allocations BoringSSL keeps off
// OPENSSL_malloc (TLS record buffers, the error queue, thread-local tables).
// Freeing does not zero.
void *OPENSSL_system_malloc(size_t size) { return malloc(size); }

void *OPENSSL_system_realloc(void *ptr, size_t size) { return realloc(ptr, size); }

void OPENSSL_system_free(void *ptr) { free(ptr); }
#endif

#if defined(BORINGSSL_PEM_FAST_PUBLIC_BASE64)
#include <openssl/base64.h>
#include <openssl/mem.h>
#include <openssl/pem.h>

// <openssl/pem.h>: base64 for the PEM blocks that hold public data. The same
// shape as the reference hooks in BoringSSL's crypto/pem/pem_test.cc.
int OPENSSL_pem_public_base64_decode(uint8_t *out, size_t *out_len, size_t max_out,
                                     const uint8_t *in, size_t in_len) {
    uint8_t *stripped = malloc(in_len ? in_len : 1);
    if (stripped == NULL) return 0;
    size_t n = 0;
    for (size_t i = 0; i < in_len; i++) {
        if (!OPENSSL_isspace(in[i])) stripped[n++] = in[i];
    }
    int ok = EVP_DecodeBase64(out, out_len, max_out, stripped, n);
    free(stripped);
    return ok;
}

size_t OPENSSL_pem_public_base64_encode(char *out, size_t max_out, const uint8_t *in,
                                        size_t in_len) {
    size_t written = 0;
    while (in_len > 0) {
        // 48 input bytes fill one line of 64 characters.
        size_t n = in_len > 48 ? 48 : in_len;
        // EVP_EncodeBlock also writes a NUL, which the newline then replaces.
        if (written + (n + 2) / 3 * 4 + 1 > max_out) return 0;
        written += EVP_EncodeBlock((uint8_t *)out + written, in, n);
        out[written++] = '\n';
        in += n;
        in_len -= n;
    }
    return written;
}
#endif
