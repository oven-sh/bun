#include "root.h"
#include "BunHostPath.h"

#if defined(BUN_PORTABLE)

#include <wtf/ASCIICType.h>
#include <wtf/HexNumber.h>
#include <wtf/Vector.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>

// The Windows halves of WTF::URL::fileSystemPath() and WTF::URL::fileURLWithFileSystemPath()
// (Source/WTF/wtf/URL.cpp, inside OS(WINDOWS)), with the same results.

namespace Bun {

WTF::String windowsFileSystemPath(const WTF::URL& url)
{
    if (!url.protocolIsFile())
        return {};

    // The path of a parsed URL is ASCII. One leading slash goes, every other slash is a backslash, and an
    // escape sequence is the byte it names: "%2F" stays a slash.
    const WTF::StringView path = url.path();
    const unsigned length = path.length();
    WTF::Vector<Latin1Character, 256> decoded;
    decoded.reserveInitialCapacity(length);
    for (unsigned i = (length && path[0] == '/') ? 1 : 0; i < length;) {
        const char16_t character = path[i];
        if (character == '%' && i + 3 <= length && isASCIIHexDigit(path[i + 1]) && isASCIIHexDigit(path[i + 2])) {
            decoded.append(toASCIIHexValue(path[i + 1], path[i + 2]));
            i += 3;
            continue;
        }
        decoded.append(character == '/' ? '\\' : static_cast<Latin1Character>(character));
        ++i;
    }
    WTF::String decodedPath = WTF::String::fromUTF8ReplacingInvalidSequences(decoded.span());

    const WTF::StringView host = url.host();
    if (host.length() > 0) [[unlikely]]
        return makeString("\\\\"_s, host, "\\"_s, decodedPath);
    return decodedPath;
}

// What Node's pathToFileURL escapes: \0 \t \n \r space " # % ? [ ] ^ | ~ and every byte that is not ASCII.
// A backslash is a separator on Windows and stays: the URL parser makes it a slash.
static bool isEscapedInWindowsFilePath(uint8_t byte)
{
    switch (byte) {
    case 0:
    case '\t':
    case '\n':
    case '\r':
    case ' ':
    case '"':
    case '#':
    case '%':
    case '?':
    case '[':
    case ']':
    case '^':
    case '|':
    case '~':
        return true;
    default:
        return byte >= 128;
    }
}

static WTF::String escapeWindowsFilePath(WTF::StringView path)
{
    const WTF::CString utf8 = path.utf8();
    WTF::StringBuilder builder;
    builder.reserveCapacity(utf8.length());
    for (const char character : utf8.span()) {
        const auto byte = static_cast<uint8_t>(character);
        if (isEscapedInWindowsFilePath(byte))
            builder.append('%', upperNibbleToASCIIHexDigit(byte), lowerNibbleToASCIIHexDigit(byte));
        else
            builder.append(character);
    }
    return builder.toString();
}

static bool isSlash(char16_t character)
{
    return character == '\\' || character == '/';
}

WTF::URL fileURLWithWindowsFileSystemPath(WTF::StringView path)
{
    // A UNC path: the server is the host of the URL.
    if (path.length() > 2 && isSlash(path[0]) && isSlash(path[1]))
        return WTF::URL(makeString("file://"_s, escapeWindowsFilePath(path.substring(2))));
    return WTF::URL(makeString("file://"_s, path.startsWith('/') ? ""_s : "/"_s, escapeWindowsFilePath(path)));
}

} // namespace Bun

#endif
