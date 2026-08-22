#include "wtf/SIMDUTF.h"

typedef struct SIMDUTFResult {
    int error;
    size_t count;
} SIMDUTFResult;

extern "C" {

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
