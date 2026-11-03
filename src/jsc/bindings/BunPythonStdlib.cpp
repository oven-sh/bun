#include "root.h"

#include "BunPython.h"
#include <JavaScriptCore/PyVirtualFiles.h>
#include <mutex>
#include <zstd.h>

// CPython's Lib/ as src/codegen/pack-python-stdlib.ts packed it, which Python programs see as a read-only directory.
extern "C" const uint8_t bun_python_stdlib_start[];
extern "C" const uint8_t bun_python_stdlib_end[];
// src/runtime/python.rs
extern "C" size_t Bun__Python__cacheDirectory(char* buffer, size_t capacity);

namespace Bun {
namespace PythonStdlib {

using JSC::Python::VirtualDirectoryEntry;
using JSC::Python::VirtualFileKind;
using Path = std::span<const char>;

// The file is a Header, an Entry per file sorted by the bytes of its path, the paths, the data. Little-endian.
struct Header {
    char magic[8];
    uint32_t version;
    uint32_t count;
    uint64_t time; // of every file, in seconds since the epoch
};

// Offsets are from the start of the file. There are no entries for directories: a directory is the prefix of a path.
struct Entry {
    uint32_t pathOffset; // "python/lib/python3.15/os.py"
    uint32_t pathLength;
    uint32_t dataOffset;
    uint32_t storedSize; // of a zstd frame, or of the file as it is if that is the size
    uint32_t size;
};

static const Header& header() { return *reinterpret_cast<const Header*>(bun_python_stdlib_start); }
static const Entry* firstEntry() { return reinterpret_cast<const Entry*>(bun_python_stdlib_start + sizeof(Header)); }
static const Entry* endOfEntries() { return firstEntry() + header().count; }
static Path pathOf(const Entry& entry) { return { reinterpret_cast<const char*>(bun_python_stdlib_start) + entry.pathOffset, entry.pathLength }; }

static int compare(Path a, Path b)
{
    if (int order = memcmp(a.data(), b.data(), std::min(a.size(), b.size())))
        return order;
    return a.size() < b.size() ? -1 : a.size() > b.size();
}

static bool isUnder(const Entry* entry, Path directoryWithSlash)
{
    return entry != endOfEntries() && pathOf(*entry).size() >= directoryWithSlash.size() && !compare(pathOf(*entry).first(directoryWithSlash.size()), directoryWithSlash);
}

// The first entry whose path is not before `path`.
static const Entry* lowerBound(Path path)
{
    return std::lower_bound(firstEntry(), endOfEntries(), path, [](const Entry& entry, Path path) {
        return compare(pathOf(entry), path) < 0;
    });
}

static const Entry* findFile(Path path)
{
    const Entry* entry = lowerBound(path);
    return entry != endOfEntries() && !compare(pathOf(*entry), path) ? entry : nullptr;
}

// "a/b" -> "a/b/": what the paths of all that is in the directory start with. They follow one another in the index.
static Vector<char, 128> withSlash(Path directory)
{
    Vector<char, 128> result;
    result.append(directory);
    if (!directory.empty())
        result.append('/');
    return result;
}

static VirtualFileKind kindOf(Path path, uint64_t& size)
{
    if (const Entry* file = findFile(path)) {
        size = file->size;
        return VirtualFileKind::File;
    }
    size = 0;
    auto directory = withSlash(path);
    return isUnder(lowerBound(directory.span()), directory.span()) ? VirtualFileKind::Directory : VirtualFileKind::None;
}

static bool read(Path path, Vector<uint8_t>& contents)
{
    const Entry* file = findFile(path);
    if (!file)
        return false;
    std::span<const uint8_t> stored { bun_python_stdlib_start + file->dataOffset, file->storedSize };
    if (file->storedSize == file->size) {
        contents.append(stored);
        return true;
    }
    contents.grow(file->size);
    size_t written = ZSTD_decompress(contents.mutableSpan().data(), file->size, stored.data(), stored.size());
    RELEASE_ASSERT(written == file->size);
    return true;
}

static void list(Path path, Vector<VirtualDirectoryEntry>& result)
{
    auto directory = withSlash(path);
    const Entry* entry = lowerBound(directory.span());
    while (isUnder(entry, directory.span())) {
        Path rest = pathOf(*entry).subspan(directory.size());
        auto* slash = static_cast<const char*>(memchr(rest.data(), '/', rest.size()));
        if (!slash) {
            result.append({ UTF8CString::fromUTF8(rest), VirtualFileKind::File });
            ++entry;
            continue;
        }
        Path name = rest.first(slash - rest.data());
        result.append({ UTF8CString::fromUTF8(name), VirtualFileKind::Directory });
        // On to what follows all that is in the subdirectory: '0' is the byte after '/'.
        auto pastSubdirectory = directory;
        pastSubdirectory.append(name);
        pastSubdirectory.append('0');
        entry = lowerBound(pastSubdirectory.span());
    }
}

static bool cacheDirectory(Vector<char, 256>& path)
{
    char buffer[4096];
    size_t length = Bun__Python__cacheDirectory(buffer, sizeof(buffer));
    path.append(std::span<const char> { buffer, length });
    return length;
}

} // namespace PythonStdlib

void installPythonStandardLibrary()
{
    using namespace PythonStdlib;
    static std::once_flag once;
    std::call_once(once, [] {
        RELEASE_ASSERT(bun_python_stdlib_end - bun_python_stdlib_start > static_cast<ptrdiff_t>(sizeof(Header)) && !memcmp(header().magic, "BUNPYLIB", 8) && header().version == 1);
        // Beside "/$bunfs/root", where a standalone executable has its files.
        static const JSC::Python::VirtualFileSystem fileSystem { "/$bunfs"_s, "/$bunfs/python"_s, "/$bunfs/python/lib/bun"_s, static_cast<int64_t>(header().time), kindOf, read, list, cacheDirectory };
        JSC::Python::setVirtualFileSystem(&fileSystem);
    });
}

} // namespace Bun
