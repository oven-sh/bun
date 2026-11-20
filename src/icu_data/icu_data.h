#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

// The repacked libicudata.a defines these. With any other ICU, no item is compressed.
extern "C" __attribute__((weak)) const unsigned char bun_icu_zstd_dict[];
extern "C" __attribute__((weak)) const unsigned int bun_icu_zstd_dict_size;

namespace Bun {
struct ICUDictionary;
}

// `length` is what ICU's table of contents says, which is nothing for the last item.
extern "C" int32_t Bun__ICUItem__size(const void* item, int32_t length);
extern "C" bool Bun__ICUItem__decompress(const void* item, int32_t length, const unsigned char* dictionary, size_t dictionarySize, Bun::ICUDictionary** parsed, void* out, size_t size);

namespace Bun {

// Other items have 0xda 0x27 at bytes 2 and 3 (ucmndata.h), so they never start like a zstd frame.
inline bool isCompressedICUItem(const void* item)
{
    return !std::memcmp(item, "\x28\xB5\x2F\xFD", 4);
}

// `parsed` is null at first. It is the same for all calls, which come one at a time.
inline bool decompressICUItem(ICUDictionary*& parsed, const void* item, int32_t length, void* out, int32_t size)
{
    size_t dictionarySize = &bun_icu_zstd_dict_size ? bun_icu_zstd_dict_size : 0;
    return Bun__ICUItem__decompress(item, length, bun_icu_zstd_dict, dictionarySize, &parsed, out, static_cast<size_t>(size));
}

} // namespace Bun
