// Bench-only implementations of the `simdutf__*` C symbols Bun's Rust side calls
// (`src/simdutf_sys`), wrapping the upstream simdutf amalgamation.
#include "simdutf.h"

typedef struct SIMDUTFResult {
  int error;
  size_t count;
} SIMDUTFResult;

extern "C" {

bool simdutf__validate_utf8(const char* buf, size_t len) {
  return simdutf::validate_utf8(buf, len);
}

SIMDUTFResult simdutf__validate_utf8_with_errors(const char* buf, size_t len) {
  auto r = simdutf::validate_utf8_with_errors(buf, len);
  return {r.error, r.count};
}

bool simdutf__validate_ascii(const char* buf, size_t len) {
  return simdutf::validate_ascii(buf, len);
}

SIMDUTFResult simdutf__validate_ascii_with_errors(const char* buf, size_t len) {
  auto r = simdutf::validate_ascii_with_errors(buf, len);
  return {r.error, r.count};
}

size_t simdutf__utf8_length_from_utf16le(const char16_t* input, size_t length) {
  return simdutf::utf8_length_from_utf16le(input, length);
}

size_t simdutf__utf8_length_from_latin1(const char* input, size_t length) {
  return simdutf::utf8_length_from_latin1(input, length);
}

size_t simdutf__utf16_length_from_utf8(const char* input, size_t length) {
  return simdutf::utf16_length_from_utf8(input, length);
}

size_t simdutf__latin1_length_from_utf8(const char* input, size_t length) {
  return simdutf::latin1_length_from_utf8(input, length);
}

SIMDUTFResult simdutf__convert_utf16le_to_utf8_with_errors(const char16_t* input, size_t length,
                                                           char* output) {
  auto r = simdutf::convert_utf16le_to_utf8_with_errors(input, length, output);
  return {r.error, r.count};
}

size_t simdutf__convert_utf16le_to_utf8(const char16_t* input, size_t length, char* output) {
  return simdutf::convert_utf16le_to_utf8(input, length, output);
}

SIMDUTFResult simdutf__convert_utf8_to_utf16le_with_errors(const char* input, size_t length,
                                                           char16_t* output) {
  auto r = simdutf::convert_utf8_to_utf16le_with_errors(input, length, output);
  return {r.error, r.count};
}

size_t simdutf__convert_utf8_to_utf16le(const char* input, size_t length, char16_t* output) {
  return simdutf::convert_utf8_to_utf16le(input, length, output);
}

size_t simdutf__convert_latin1_to_utf8(const char* input, size_t length, char* output) {
  return simdutf::convert_latin1_to_utf8(input, length, output);
}

size_t simdutf__convert_utf8_to_latin1(const char* input, size_t length, char* output) {
  return simdutf::convert_utf8_to_latin1(input, length, output);
}

SIMDUTFResult simdutf__convert_utf8_to_latin1_with_errors(const char* input, size_t length,
                                                          char* output) {
  auto r = simdutf::convert_utf8_to_latin1_with_errors(input, length, output);
  return {r.error, r.count};
}

size_t simdutf__count_utf8(const char* input, size_t length) {
  return simdutf::count_utf8(input, length);
}

}
