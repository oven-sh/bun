// The embedder hooks Bun's BoringSSL objects call.
//
// scripts/build/deps/boringssl.ts compiles BoringSSL with
// BORINGSSL_REQUIRE_MEMORY_HOOKS and BORINGSSL_PEM_FAST_PUBLIC_BASE64, which
// turn the functions below into undefined symbols the embedder has to supply.
// The bun binary gets them from src/boringssl/lib.rs (mimalloc) and
// src/simdutf_sys/bun-simdutf.cpp (simdutf). h3blast links the same objects
// without either, so it supplies libc-backed ones.

#define _GNU_SOURCE
#define BORINGSSL_PEM_FAST_PUBLIC_BASE64
#include <malloc.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <openssl/base64.h>
#include <openssl/mem.h>
#include <openssl/pem.h>

// crypto/mem.cc: back OPENSSL_malloc/OPENSSL_free. The free hook has to zero
// the block itself and is never passed NULL.
void *OPENSSL_memory_alloc(size_t size) { return malloc(size); }

size_t OPENSSL_memory_get_size(void *ptr) { return malloc_usable_size(ptr); }

void OPENSSL_memory_free(void *ptr) {
    explicit_bzero(ptr, malloc_usable_size(ptr));
    free(ptr);
}

// crypto/internal.h: back the allocations BoringSSL keeps off OPENSSL_malloc
// (TLS record buffers, the error queue, thread-local tables). Not zeroed.
void *OPENSSL_system_malloc(size_t size) { return malloc(size); }

void *OPENSSL_system_realloc(void *ptr, size_t size) { return realloc(ptr, size); }

void OPENSSL_system_free(void *ptr) { free(ptr); }

// <openssl/pem.h>: base64 for PEM blocks that carry public data. Same shape as
// the reference hooks in BoringSSL's crypto/pem/pem_test.cc.
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
        // 48 input bytes fill one 64-character line.
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
