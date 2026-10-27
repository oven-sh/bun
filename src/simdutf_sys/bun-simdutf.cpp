#include "wtf/SIMDUTF.h"

typedef struct SIMDUTFResult {
    int error;
    size_t count;
} SIMDUTFResult;

extern "C" {

// When CPUID advertises none of the compiled-in kernels (QEMU's default CPU
// model hides SSE4.2 that the host executes), simdutf installs a stub whose
// every method returns 0 / false. WTF builds simdutf without the scalar
// fallback, so pick the last kernel in the priority-ordered list: on x64 that
// is westmere, the same -march=nehalem baseline the whole binary runs.
void simdutf__init()
{
    if (simdutf::get_active_implementation()->name() != "unsupported")
        return;

    const simdutf::implementation* least_demanding = nullptr;
    for (const simdutf::implementation* impl : simdutf::get_available_implementations())
        least_demanding = impl;

    if (least_demanding)
        simdutf::get_active_implementation() = least_demanding;
}

bool simdutf__validate_utf8(const char* buf, size_t len)
{
    return simdutf::validate_utf8(buf, len);
}

SIMDUTFResult simdutf__validate_utf8_with_errors(const char* buf, size_t len)
{
    auto res = simdutf::validate_utf8_with_errors(buf, len);
    return { res.error, res.count };
}

bool simdutf__validate_ascii(const char* buf, size_t len)
{
    return simdutf::validate_ascii(buf, len);
}

SIMDUTFResult simdutf__validate_ascii_with_errors(const char* buf, size_t len)
{
    auto res = simdutf::validate_ascii_with_errors(buf, len);
    return { res.error, res.count };
}

bool simdutf__validate_utf16le(const char16_t* buf, size_t len)
{
    return simdutf::validate_utf16le(buf, len);
}

SIMDUTFResult
simdutf__convert_utf8_to_utf16le_with_errors(const char* buf, size_t len,
    char16_t* utf16_output)
{
    auto res = simdutf::convert_utf8_to_utf16le_with_errors(buf, len, utf16_output);
    return { res.error, res.count };
}

SIMDUTFResult simdutf__convert_utf16le_to_utf8_with_errors(const char16_t* buf,
    size_t len,
    char* utf8_buffer)
{
    auto res = simdutf::convert_utf16le_to_utf8_with_errors(buf, len, utf8_buffer);
    return { res.error, res.count };
}

size_t simdutf__convert_valid_utf16le_to_utf8(const char16_t* buf, size_t len,
    char* utf8_buffer)
{
    return simdutf::convert_valid_utf16le_to_utf8(buf, len, utf8_buffer);
}

size_t simdutf__utf8_length_from_utf16le(const char16_t* input, size_t length)
{
    return simdutf::utf8_length_from_utf16le(input, length);
}

// Unlike the non-validating variant above, this charges 3 bytes (U+FFFD) per
// unpaired surrogate, matching the replacement encoder's output. `.count` is
// documented to be correct even when `.error` is SURROGATE.
size_t simdutf__utf8_length_from_utf16le_with_replacement(const char16_t* input, size_t length)
{
    return simdutf::utf8_length_from_utf16le_with_replacement(input, length).count;
}

size_t simdutf__utf16_length_from_utf8(const char* input, size_t length)
{
    return simdutf::utf16_length_from_utf8(input, length);
}

size_t simdutf__utf8_length_from_latin1(const char* input, size_t length)
{
    return simdutf::utf8_length_from_latin1(input, length);
}

size_t simdutf__base64_encode(const char* input, size_t length, char* output, int is_urlsafe)
{
    return simdutf::binary_to_base64(input, length, output, is_urlsafe ? simdutf::base64_url : simdutf::base64_default);
}

size_t simdutf__base64_length_from_binary(size_t length, int is_urlsafe)
{
    return simdutf::base64_length_from_binary(length, is_urlsafe ? simdutf::base64_url : simdutf::base64_default);
}

SIMDUTFResult simdutf__base64_decode_from_binary(const char* input, size_t length, char* output, size_t outlen_, int is_urlsafe)
{
    size_t outlen = outlen_;
    auto res = simdutf::base64_to_binary_safe(input, length, output, outlen, is_urlsafe ? simdutf::base64_url : simdutf::base64_default);

    if (res.error == simdutf::error_code::SUCCESS) {
        return { .error = 0, .count = outlen };
    }

    return { .error = res.error, .count = res.count };
}

// Lenient base64 decoding for Node.js Buffer semantics ("base64" and
// "base64url"): both the standard and URL-safe alphabets are accepted,
// whitespace and any other non-alphabet characters are skipped, and decoding
// stops at the first '='. This is simdutf's base64_default_or_url_accept_garbage
// mode combined with loose handling of the final chunk.
SIMDUTFResult simdutf__base64_decode_from_binary_lenient(const char* input, size_t length, char* output, size_t outlen_)
{
    size_t outlen = outlen_;
    auto res = simdutf::base64_to_binary_safe(input, length, output, outlen,
        simdutf::base64_default_or_url_accept_garbage,
        simdutf::last_chunk_handling_options::loose);

    if (res.error == simdutf::error_code::SUCCESS) {
        return { .error = 0, .count = outlen };
    }

    return { .error = res.error, .count = res.count };
}
}

// BoringSSL is built with BORINGSSL_PEM_FAST_PUBLIC_BASE64 (scripts/build/deps/boringssl.ts),
// which routes the base64 of PEM CERTIFICATE / CRL / PUBLIC KEY blocks here instead of through
// its constant-time codec. Private-key PEM never reaches these. Contract: <openssl/pem.h>.
extern "C" int OPENSSL_pem_public_base64_decode(uint8_t* out, size_t* out_len, size_t max_out, const uint8_t* in, size_t in_len)
{
    size_t written = max_out;
    auto res = simdutf::base64_to_binary_safe(reinterpret_cast<const char*>(in), in_len, reinterpret_cast<char*>(out), written, simdutf::base64_default);
    if (res.error != simdutf::error_code::SUCCESS)
        return 0;
    // simdutf tolerates missing '=' padding; PEM (like EVP_DecodeUpdate, OpenSSL and Go) does not.
    size_t padding = 0;
    for (size_t i = in_len; i > 0; i--) {
        uint8_t c = in[i - 1];
        if (c == '=')
            padding++;
        else if (c != '\n' && c != '\r' && c != ' ' && c != '\t' && c != '\f' && c != '\v')
            break;
    }
    if (padding != (3 - written % 3) % 3)
        return 0;
    *out_len = written;
    return 1;
}

extern "C" size_t OPENSSL_pem_public_base64_encode(char* out, size_t max_out, const uint8_t* in, size_t in_len)
{
    constexpr size_t lineLength = 64;
    size_t needed = simdutf::base64_length_from_binary_with_lines(in_len, simdutf::base64_default, lineLength) + 1;
    if (in_len == 0 || needed > max_out)
        return 0;
    size_t written = simdutf::binary_to_base64_with_lines(reinterpret_cast<const char*>(in), in_len, out, lineLength, simdutf::base64_default);
    // EVP_EncodeFinal terminates the last line too.
    out[written++] = '\n';
    return written;
}
