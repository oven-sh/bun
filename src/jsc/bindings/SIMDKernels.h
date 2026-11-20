#pragma once

#include <cstddef>
#include <cstdint>

// src/runtime/simd_exports.rs. A pointer can be null if its length is 0.
extern "C" {

// For the bytes of JS buffers: any address, any overlap, and other threads may write them. WTF::notFound if there is no match.
size_t Bun__simd__indexOfByte(const uint8_t* haystack, size_t length, uint8_t needle);
size_t Bun__simd__lastIndexOfByte(const uint8_t* haystack, size_t length, uint8_t needle);
size_t Bun__simd__indexOfBytes(const uint8_t* haystack, size_t length, const uint8_t* needle, size_t needleLength);
size_t Bun__simd__lastIndexOfBytes(const uint8_t* haystack, size_t length, const uint8_t* needle, size_t needleLength);
// The lengths are in bytes, the result is in pairs of bytes.
size_t Bun__simd__indexOfPairs(const uint8_t* haystack, size_t length, const uint8_t* needle, size_t needleLength);
size_t Bun__simd__lastIndexOfPairs(const uint8_t* haystack, size_t length, const uint8_t* needle, size_t needleLength);
void Bun__simd__swap16(uint8_t* bytes, size_t length);
void Bun__simd__swap32(uint8_t* bytes, size_t length);
void Bun__simd__swap64(uint8_t* bytes, size_t length);
uint64_t Bun__simd__xxHash3(const uint8_t* bytes, size_t length);

// For text that does not change during the call. `length` if there is no match.
size_t Bun__simd__indexOfNonASCII8(const uint8_t* text, size_t length);
size_t Bun__simd__indexOfNonASCII16(const char16_t* text, size_t length);
size_t Bun__simd__indexOfASCIIUpper8(const uint8_t* text, size_t length);
size_t Bun__simd__indexOfASCIIUpper16(const char16_t* text, size_t length);
size_t Bun__simd__indexOfANSIEscape8(const uint8_t* text, size_t length);
size_t Bun__simd__indexOfANSIEscape16(const char16_t* text, size_t length);
size_t Bun__simd__indexOfHTMLEscape8(const uint8_t* text, size_t length);
size_t Bun__simd__indexOfHTMLEscape16(const char16_t* text, size_t length);
size_t Bun__simd__htmlEscapeExtraLength8(const uint8_t* text, size_t length);
size_t Bun__simd__htmlEscapeExtraLength16(const char16_t* text, size_t length);
size_t Bun__simd__countPrintableASCII16(const char16_t* text, size_t length);
size_t Bun__simd__visibleLatin1Width(const uint8_t* text, size_t length);
size_t Bun__simd__visibleLatin1WidthExcludeANSI(const uint8_t* text, size_t length);
// Returns how many units `width` is for.
size_t Bun__simd__visibleUTF16Width(const char16_t* text, size_t length, size_t& width);
void Bun__simd__lowerASCII8(const uint8_t* text, size_t length, uint8_t* output, size_t outputLength);
void Bun__simd__lowerASCII16(const char16_t* text, size_t length, char16_t* output, size_t outputLength);
void Bun__simd__narrowTo8Bit(const char16_t* text, size_t length, uint8_t* output, size_t outputLength);
}
