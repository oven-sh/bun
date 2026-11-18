#include "engine/Support.h"

extern "C" bool Support__readEntireFile(const char8_t* path, size_t length, void* context, void (*receive)(void* context, const uint8_t*, size_t));

namespace WTF::FileSystemImpl {

std::optional<Vector<uint8_t>> readEntireFile(const String& path)
{
    Vector<uint8_t> contents;
    auto receive = [](void* context, const uint8_t* bytes, size_t length) {
        static_cast<Vector<uint8_t>*>(context)->append(std::span { bytes, length });
    };
    auto bytes = path.utf8();
    if (!Support__readEntireFile(bytes.span().data(), bytes.length(), &contents, receive))
        return std::nullopt;
    return contents;
}

}
