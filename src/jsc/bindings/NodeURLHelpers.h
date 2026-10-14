#pragma once

// URL helpers implemented in NodeURL.cpp, declared separately so
// WebCore-layer consumers (URLDecomposition.cpp, DOMURL.cpp) do not pull in
// ZigGlobalObject.h via NodeURL.h.

#include <cstdint>
#include <wtf/URL.h>
#include <wtf/Markable.h>

namespace JSC {
class JSGlobalObject;
class JSObject;
}

namespace Bun {

// True when every xn-- label in `host` is valid UTS #46 punycode.
bool hasValidPunycodeHost(WTF::StringView host);

// The one call of WTF::URL::fileSystemPath() in Bun (test/internal/source-lints/file-system-path.test.ts).
// Empty when `url` is not a file: URL, and when its percent-decoded path is not UTF-8. WTF returns a
// null String for both, and a null String reads as "": the current directory. On Windows WTF decodes
// such a path with U+FFFD in it instead (oven-sh/WebKit#789).
ALWAYS_INLINE WTF::Markable<WTF::String> fileSystemPath(const WTF::URL& url)
{
    return url.fileSystemPath();
}

// For a file: URL that Bun made from a path (a source origin, import.meta.url). It always decodes.
ALWAYS_INLINE WTF::String fileSystemPathOfInternalURL(const WTF::URL& url)
{
    auto path = fileSystemPath(url);
    ASSERT(path || !url.protocolIsFile());
    return WTF::move(path).unsafeValue();
}

// Why Bun::fileURLToPath() gave no path. Mirrored by `ToFileSystemPathError` in src/jsc/DOMURL.rs.
enum class FileURLToPathError : uint8_t {
    NotFileURL = 0,
    InvalidHost = 1,
    // An encoded "/", and on Windows an encoded "\".
    InvalidPath = 2,
    // The percent-decoded path is not UTF-8.
    Undecodable = 3,
};

// `%2f` or `%2F` in a path that has a "%", and on Windows `%5c` or `%5C`.
bool hasEncodedPathSeparator(WTF::StringView path);

// Node's fileURLToPath() for the host platform, in Node's order of checks. Sets `error` when the result is empty.
// For a URL from the user where Node's rules apply: Bun.fileURLToPath() and each node:fs function.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/url.js#L1622-L1631
ALWAYS_INLINE WTF::Markable<WTF::String> fileURLToPath(const WTF::URL& url, FileURLToPathError& error)
{
    if (!url.protocolIsFile()) [[unlikely]] {
        error = FileURLToPathError::NotFileURL;
        return {};
    }
#if !OS(WINDOWS)
    // On Windows the host is the server of a UNC path.
    if (!url.host().isEmpty()) [[unlikely]] {
        error = FileURLToPathError::InvalidHost;
        return {};
    }
#endif
    const WTF::StringView encodedPath = url.path();
    if (encodedPath.contains('%') && hasEncodedPathSeparator(encodedPath)) {
        error = FileURLToPathError::InvalidPath;
        return {};
    }
    auto path = fileSystemPath(url);
    if (!path)
        error = FileURLToPathError::Undecodable;
    return path;
}

// What Node's fileURLToPath() throws for `Undecodable`: `URIError: URI malformed`. It has no `code`,
// so it is not ERR_INVALID_URI.
JSC::JSObject* createURIMalformedError(JSC::JSGlobalObject*);

} // namespace Bun
