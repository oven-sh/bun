#include "wtf/SIMDUTF.h"

typedef struct SIMDUTFResult {
    int error;
    size_t count;
} SIMDUTFResult;

extern "C" {

int simdutf__detect_encodings(const char* input, size_t length)
{
    return simdutf::detect_encodings(input, length);
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

SIMDUTFResult simdutf__validate_ascii_with_errors(const unsigned char* buf, size_t len)
{
    switch (len) {
    case 0:
        return { 0, 0 };
    case 1:
        return { buf[0] < 128 ? 0 : 1, buf[0] < 128 ? 1ull : 0ull };
    case 2: {
        const uint16_t value = *(uint16_t*)buf;
        const uint16_t mask = value & 0x8080;
        if (mask == 0) {
            return { 0, 2 };
        }
        const size_t pos = (__builtin_ffs(mask) - 1) / 8;
        return { 1, pos };
    }
    case 3: {
        const uint16_t value = *(uint16_t*)buf;
        const uint16_t mask = value & 0x8080;
        if (mask == 0) {
            if (buf[2] >= 128) {
                return { 1, 2 };
            }
            return { 0, 3 };
        }
        const size_t pos = (__builtin_ffs(mask) - 1) / 8;
        return { 1, pos };
    }
    case 4: {
        const uint32_t value = *(uint32_t*)buf;
        const uint32_t mask = value & 0x80808080;
        if (mask == 0) {
            return { 0, 4 };
        }
        const size_t pos = (__builtin_ffs(mask) - 1) / 8;
        return { 1, pos };
    }
    case 5: {
        // Check first 4 bytes
        const uint32_t first_four = *(uint32_t*)buf;
        const uint32_t mask = first_four & 0x80808080;
        if (mask != 0) {
            const size_t pos = (__builtin_ffs(mask) - 1) / 8;
            return { 1, pos };
        }
        // Check remaining byte
        if (buf[4] >= 128) {
            return { 1, 4 };
        }
        return { 0, 5 };
    }
    case 6: {
        // Check first 4 bytes
        const uint32_t first_four = *(uint32_t*)buf;
        const uint32_t mask_first = first_four & 0x80808080;
        if (mask_first != 0) {
            const size_t pos = (__builtin_ffs(mask_first) - 1) / 8;
            return { 1, pos };
        }

        // Check last 2 bytes
        const uint16_t last_two = *(uint16_t*)(buf + 4);
        const uint16_t mask_last = last_two & 0x8080;
        if (mask_last != 0) {
            const size_t pos = (__builtin_ffs(mask_last) - 1) / 8;
            return { 1, pos + 4 };
        }

        return { 0, 6 };
    }
    case 7: {
        // Check first 4 bytes
        const uint32_t first_four = *(uint32_t*)buf;
        const uint32_t mask = first_four & 0x80808080;
        if (mask != 0) {
            const size_t pos = (__builtin_ffs(mask) - 1) / 8;
            return { 1, pos };
        }
        // Check remaining bytes
        for (size_t i = 4; i < 7; i++) {
            if (buf[i] >= 128) {
                return { 1, i };
            }
        }
        return { 0, 7 };
    }
    case 8: {
        const uint64_t value = *(uint64_t*)buf;
        const uint64_t mask = value & 0x8080808080808080ULL;
        if (mask == 0) {
            return { 0, 8 };
        }
        const size_t pos = (__builtin_ffsll(mask) - 1) / 8;
        return { 1, pos };
    }
    default: {
        auto res = simdutf::validate_ascii_with_errors((const char*)buf, len);
        return { res.error, res.count };
    }
    }
}

bool simdutf__validate_utf16le(const char16_t* buf, size_t len)
{
    return simdutf::validate_utf16le(buf, len);
}

bool simdutf__validate_utf16be(const char16_t* buf, size_t len)
{
    return simdutf::validate_utf16be(buf, len);
}

SIMDUTFResult simdutf__validate_utf16le_with_errors(const char16_t* buf,
    size_t len)
{
    auto res = simdutf::validate_utf16le_with_errors(buf, len);
    return { res.error, res.count };
}

SIMDUTFResult simdutf__validate_utf16be_with_errors(const char16_t* buf,
    size_t len)
{
    auto res = simdutf::validate_utf16be_with_errors(buf, len);
    return { res.error, res.count };
}

bool simdutf__validate_utf32(const char32_t* buf, size_t len)
{
    return simdutf::validate_utf32(buf, len);
}

SIMDUTFResult simdutf__validate_utf32_with_errors(const char32_t* buf,
    size_t len)
{
    auto res = simdutf::validate_utf32_with_errors(buf, len);
    return { res.error, res.count };
}

size_t simdutf__convert_utf8_to_utf16le(const char* buf, size_t len,
    char16_t* utf16_output)
{
    return simdutf::convert_utf8_to_utf16le(buf, len, utf16_output);
}

size_t simdutf__convert_utf8_to_utf16be(const char* buf, size_t len,
    char16_t* utf16_output)
{
    return simdutf::convert_utf8_to_utf16be(buf, len, utf16_output);
}
SIMDUTFResult
simdutf__convert_utf8_to_utf16le_with_errors(const char* buf, size_t len,
    char16_t* utf16_output)
{
    auto res = simdutf::convert_utf8_to_utf16le_with_errors(buf, len, utf16_output);
    return { res.error, res.count };
}

SIMDUTFResult
simdutf__convert_utf8_to_utf16be_with_errors(const char* buf, size_t len,
    char16_t* utf16_output)
{
    auto res = simdutf::convert_utf8_to_utf16be_with_errors(buf, len, utf16_output);
    return { res.error, res.count };
}
size_t simdutf__convert_valid_utf8_to_utf16le(const char* buf, size_t len,
    char16_t* utf16_buffer)
{
    return simdutf::convert_valid_utf8_to_utf16le(buf, len, utf16_buffer);
}

size_t simdutf__convert_valid_utf8_to_utf16be(const char* buf, size_t len,
    char16_t* utf16_buffer)
{
    return simdutf::convert_valid_utf8_to_utf16be(buf, len, utf16_buffer);
}

size_t simdutf__convert_utf8_to_utf32(const char* buf, size_t len,
    char32_t* utf32_output)
{
    return simdutf::convert_utf8_to_utf32(buf, len, utf32_output);
}
SIMDUTFResult
simdutf__convert_utf8_to_utf32_with_errors(const char* buf, size_t len,
    char32_t* utf32_output)
{
    auto res = simdutf::convert_utf8_to_utf32_with_errors(buf, len, utf32_output);
    return { res.error, res.count };
}

size_t simdutf__convert_valid_utf8_to_utf32(const char* buf, size_t len,
    char32_t* utf32_buffer)
{
    return simdutf::convert_valid_utf8_to_utf32(buf, len, utf32_buffer);
}

size_t simdutf__convert_utf16le_to_utf8(const char16_t* buf, size_t len,
    char* utf8_buffer)
{
    return simdutf::convert_utf16le_to_utf8(buf, len, utf8_buffer);
}

size_t simdutf__convert_utf16be_to_utf8(const char16_t* buf, size_t len,
    char* utf8_buffer)
{
    return simdutf::convert_utf16be_to_utf8(buf, len, utf8_buffer);
}
SIMDUTFResult simdutf__convert_utf16le_to_utf8_with_errors(const char16_t* buf,
    size_t len,
    char* utf8_buffer)
{
    auto res = simdutf::convert_utf16le_to_utf8_with_errors(buf, len, utf8_buffer);
    return { res.error, res.count };
}

SIMDUTFResult simdutf__convert_utf16be_to_utf8_with_errors(const char16_t* buf,
    size_t len,
    char* utf8_buffer)
{
    auto res = simdutf::convert_utf16be_to_utf8_with_errors(buf, len, utf8_buffer);
    return { res.error, res.count };
}

size_t simdutf__convert_valid_utf16le_to_utf8(const char16_t* buf, size_t len,
    char* utf8_buffer)
{
    return simdutf::convert_valid_utf16le_to_utf8(buf, len, utf8_buffer);
}

size_t simdutf__convert_valid_utf16be_to_utf8(const char16_t* buf, size_t len,
    char* utf8_buffer)
{
    return simdutf::convert_valid_utf16be_to_utf8(buf, len, utf8_buffer);
}

size_t simdutf__convert_utf32_to_utf8(const char32_t* buf, size_t len,
    char* utf8_buffer)
{
    return simdutf::convert_utf32_to_utf8(buf, len, utf8_buffer);
}

SIMDUTFResult simdutf__convert_utf32_to_utf8_with_errors(const char32_t* buf,
    size_t len,
    char* utf8_buffer)
{
    auto res = simdutf::convert_utf32_to_utf8_with_errors(buf, len, utf8_buffer);
    return { res.error, res.count };
}

size_t simdutf__convert_valid_utf32_to_utf8(const char32_t* buf, size_t len,
    char* utf8_buffer)
{
    return simdutf::convert_valid_utf32_to_utf8(buf, len, utf8_buffer);
}

size_t simdutf__convert_utf32_to_utf16le(const char32_t* buf, size_t len,
    char16_t* utf16_buffer)
{
    return simdutf::convert_utf32_to_utf16le(buf, len, utf16_buffer);
}

size_t simdutf__convert_utf32_to_utf16be(const char32_t* buf, size_t len,
    char16_t* utf16_buffer)
{
    return simdutf::convert_utf32_to_utf16be(buf, len, utf16_buffer);
}

SIMDUTFResult
simdutf__convert_utf32_to_utf16le_with_errors(const char32_t* buf, size_t len,
    char16_t* utf16_buffer)
{
    auto res = simdutf::convert_utf32_to_utf16le_with_errors(buf, len, utf16_buffer);
    return { res.error, res.count };
}

SIMDUTFResult
simdutf__convert_utf32_to_utf16be_with_errors(const char32_t* buf, size_t len,
    char16_t* utf16_buffer)
{
    auto res = simdutf::convert_utf32_to_utf16be_with_errors(buf, len, utf16_buffer);
    return { res.error, res.count };
}

size_t simdutf__convert_valid_utf32_to_utf16le(const char32_t* buf, size_t len,
    char16_t* utf16_buffer)
{
    return simdutf::convert_valid_utf32_to_utf16le(buf, len, utf16_buffer);
}

size_t simdutf__convert_valid_utf32_to_utf16be(const char32_t* buf, size_t len,
    char16_t* utf16_buffer)
{
    return simdutf::convert_valid_utf32_to_utf16be(buf, len, utf16_buffer);
}

size_t simdutf__convert_utf16le_to_utf32(const char16_t* buf, size_t len,
    char32_t* utf32_buffer)
{
    return simdutf::convert_utf16le_to_utf32(buf, len, utf32_buffer);
}

size_t simdutf__convert_utf16be_to_utf32(const char16_t* buf, size_t len,
    char32_t* utf32_buffer)
{
    return simdutf::convert_utf16be_to_utf32(buf, len, utf32_buffer);
}

SIMDUTFResult
simdutf__convert_utf16le_to_utf32_with_errors(const char16_t* buf, size_t len,
    char32_t* utf32_buffer)
{
    auto res = simdutf::convert_utf16le_to_utf32_with_errors(buf, len, utf32_buffer);
    return { res.error, res.count };
}

SIMDUTFResult
simdutf__convert_utf16be_to_utf32_with_errors(const char16_t* buf, size_t len,
    char32_t* utf32_buffer)
{
    auto res = simdutf::convert_utf16be_to_utf32_with_errors(buf, len, utf32_buffer);
    return { res.error, res.count };
}

size_t simdutf__convert_valid_utf16le_to_utf32(const char16_t* buf, size_t len,
    char32_t* utf32_buffer)
{
    return simdutf::convert_valid_utf16le_to_utf32(buf, len, utf32_buffer);
}
size_t simdutf__convert_valid_utf16be_to_utf32(const char16_t* buf, size_t len,
    char32_t* utf32_buffer)
{
    return simdutf::convert_valid_utf16be_to_utf32(buf, len, utf32_buffer);
}
size_t simdutf__convert_latin1_to_utf8(const char* input, size_t length, char* utf8_buffer)
{
    return simdutf::convert_latin1_to_utf8(input, length, utf8_buffer);
}
void simdutf__change_endianness_utf16(const char16_t* buf, size_t length,
    char16_t* output)
{
    simdutf::change_endianness_utf16(buf, length, output);
}

size_t simdutf__count_utf16le(const char16_t* buf, size_t length)
{
    return simdutf::count_utf16le(buf, length);
}

size_t simdutf__count_utf16be(const char16_t* buf, size_t length)
{
    return simdutf::count_utf16be(buf, length);
}

size_t simdutf__count_utf8(const char* buf, size_t length)
{
    return simdutf::count_utf8(buf, length);
}

size_t simdutf__utf8_length_from_utf16le(const char16_t* input, size_t length)
{
    return simdutf::utf8_length_from_utf16le(input, length);
}

size_t simdutf__utf8_length_from_utf16be(const char16_t* input, size_t length)
{
    return simdutf::utf8_length_from_utf16be(input, length);
}

size_t simdutf__utf32_length_from_utf16le(const char16_t* input, size_t length)
{
    return simdutf::utf32_length_from_utf16le(input, length);
}

size_t simdutf__utf32_length_from_utf16be(const char16_t* input, size_t length)
{
    return simdutf::utf32_length_from_utf16be(input, length);
}

size_t simdutf__utf16_length_from_utf8(const char* input, size_t length)
{
    return simdutf::utf16_length_from_utf8(input, length);
}

size_t simdutf__utf8_length_from_utf32(const char32_t* input, size_t length)
{
    return simdutf::utf8_length_from_utf32(input, length);
}

size_t simdutf__utf16_length_from_utf32(const char32_t* input, size_t length)
{
    return simdutf::utf16_length_from_utf32(input, length);
}

size_t simdutf__utf32_length_from_utf8(const char* input, size_t length)
{
    return simdutf::utf32_length_from_utf8(input, length);
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

SIMDUTFResult simdutf__base64_decode_from_binary16(const char16_t* input, size_t length, char* output, size_t outlen_, int is_urlsafe)
{
    size_t outlen = outlen_;
    auto res = simdutf::base64_to_binary_safe(input, length, output, outlen, is_urlsafe ? simdutf::base64_url : simdutf::base64_default);

    if (res.error == simdutf::error_code::SUCCESS) {
        return { .error = 0, .count = outlen };
    }

    return { .error = res.error, .count = res.count };
}

size_t simdutf__utf16_length_from_latin1(const char* input, size_t length)
{
    UNUSED_PARAM(input);
    return simdutf::utf16_length_from_latin1(length);
}
}
