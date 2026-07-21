#include "wtf/SIMDUTF.h"

#if defined(__APPLE__) && defined(__x86_64__)
#include <stdlib.h>
#include <sys/sysctl.h>
#endif

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

SIMDUTFResult simdutf__validate_ascii_with_errors(const char* buf, size_t len)
{
    auto res = simdutf::validate_ascii_with_errors(buf, len);
    return { res.error, res.count };
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

// Unlike the non-validating variant above, this charges 3 bytes (U+FFFD) per
// unpaired surrogate, matching the replacement encoder's output. `.count` is
// documented to be correct even when `.error` is SURROGATE.
size_t simdutf__utf8_length_from_utf16le_with_replacement(const char16_t* input, size_t length)
{
    return simdutf::utf8_length_from_utf16le_with_replacement(input, length).count;
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

size_t simdutf__utf16_length_from_latin1(const char* input, size_t length)
{
    UNUSED_PARAM(input);
    return simdutf::utf16_length_from_latin1(length);
}

// Returns whether simdutf selected a real implementation for this CPU.
//
// When built with -march=nehalem (Bun's x64 baseline) simdutf omits its
// scalar fallback because it assumes the westmere (SSE4.2) kernel can
// "always run". On a host without SSE4.2 — for example the default QEMU
// TCG vCPU, which only advertises SSE3 — the runtime dispatcher finds no
// compatible implementation and returns an `unsupported_implementation`
// stub. Every function on that stub returns 0/false/{OTHER,0}, which
// silently corrupts every downstream consumer (firstNonASCII, StringImpl
// UTF-8 creation, Base64, ...). Bun checks this once at startup so it can
// fail fast with a useful diagnostic instead of spinning for ~16 seconds
// allocating ~4 GB and then segfaulting (issue #30613).
//
// The stub's validate_ascii() unconditionally returns false, so probing it
// with a single known-ASCII byte both forces lazy dispatch to run and
// detects the stub without reaching into simdutf's private state.
bool simdutf__has_implementation()
{
    static constexpr const char probe = 'a';
    return simdutf::validate_ascii(&probe, 1);
}

// Recovers simdutf dispatch when the unsupported stub was selected under
// Rosetta 2. Returns whether simdutf is usable afterwards; always false on
// other platforms, so the caller falls through to the fail-fast diagnostic.
//
// Rosetta 2 on macOS 15+ translates every instruction the default x64 build
// emits (the whole binary is compiled with -march=haswell and executes
// fine), but the translated CPUID/XGETBV do not advertise the full Haswell
// feature set, so simdutf's runtime dispatcher matches none of its compiled
// kernels (westmere and the scalar fallback are elided at compile time once
// __AVX2__ is defined) and installs the unsupported stub. That stub made
// `bun install` spin forever while parsing bun.lock: validate_ascii_with_errors
// reports a (fake) non-ASCII byte at index 0 for every input, so
// first_non_ascii-driven scan loops over Latin-1 strings never advance.
//
// The available-implementations list is ordered most- to least-advanced, and
// simdutf's CAN_ALWAYS_RUN_* pruning guarantees the last entry requires no
// more than the ISA this translation unit itself was compiled with: if this
// code is executing at all, that kernel can execute too. An explicit
// SIMDUTF_FORCE_IMPLEMENTATION is a deliberate override, so it is honored
// (by aborting in the caller) rather than second-guessed, and the healed
// kernel is re-probed so a translator that cannot actually execute it still
// fails fast in the caller instead of running corrupted.
bool simdutf__recover_implementation_under_rosetta()
{
#if defined(__APPLE__) && defined(__x86_64__)
    if (getenv("SIMDUTF_FORCE_IMPLEMENTATION"))
        return false;

    int translated = 0;
    size_t size = sizeof(translated);
    if (sysctlbyname("sysctl.proc_translated", &translated, &size, nullptr, 0) != 0 || translated != 1)
        return false;

    const simdutf::implementation* least_demanding = nullptr;
    for (const simdutf::implementation* impl : simdutf::get_available_implementations())
        least_demanding = impl;
    if (!least_demanding)
        return false;

    simdutf::get_active_implementation() = least_demanding;
    return simdutf__has_implementation();
#else
    return false;
#endif
}
}
