// node:path — a line-for-line port of Node.js lib/path.js that operates directly
// on the Latin-1 / UTF-16 backing store of each JSString. Inputs are never
// transcoded; results that are slices of an input are returned as substrings
// sharing the input's buffer, and results that must be assembled are built once
// in a stack buffer of the inputs' character width.

#include "Path.h"
#include "root.h"
#include "ZigGlobalObject.h"
#include "BunClientData.h"
#include "ErrorCode.h"
#include "BunProcess.h"

#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSStringInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <bit>
#include <wtf/Vector.h>
#include <wtf/text/StringCommon.h>
#include <wtf/text/StringView.h>

#if OS(WINDOWS)
#include <windows.h>
#endif

extern "C" JSC::EncodedJSValue Process__getCachedCwd(JSC::JSGlobalObject*);

namespace Bun {
namespace NodePath {

using namespace JSC;

using LChar = Latin1Character;
using UChar = char16_t;
using Index = intptr_t;

template<typename C> using PathBuffer = Vector<C, 1024>;

static constexpr LChar CHAR_DOT = '.';
static constexpr LChar CHAR_FORWARD_SLASH = '/';
static constexpr LChar CHAR_BACKWARD_SLASH = '\\';
static constexpr LChar CHAR_COLON = ':';
static constexpr LChar CHAR_QUESTION_MARK = '?';

template<bool isWindows> static constexpr LChar separator = isWindows ? CHAR_BACKWARD_SLASH : CHAR_FORWARD_SLASH;

template<bool isWindows> static ALWAYS_INLINE constexpr bool isPathSeparator(UChar code)
{
    if constexpr (isWindows)
        return code == CHAR_FORWARD_SLASH || code == CHAR_BACKWARD_SLASH;
    else
        return code == CHAR_FORWARD_SLASH;
}

static ALWAYS_INLINE constexpr bool isWindowsDeviceRoot(UChar code)
{
    return static_cast<unsigned>((code | 0x20) - 'a') < 26u;
}

// isWindowsReservedName(path, colonIndex) with the StringPrototypeSlice(path, 0, colonIndex)
// already applied by the caller. StringPrototypeToUpperCase can only produce one of these
// names from its ASCII case variants (no non-ASCII code point upper-cases to any of
// A C L M N O P R T U X 1-9, and U+00B9/B2/B3 upper-case to themselves), so an ASCII
// case-insensitive comparison is exact.
template<typename C>
static bool isWindowsReservedName(std::span<const C> s)
{
    auto up = [&](size_t i) -> UChar { return WTF::toASCIIUpper(static_cast<UChar>(s[i])); };
    auto is3 = [&](char a, char b, char c) { return up(0) == a && up(1) == b && up(2) == c; };
    if (s.size() == 3)
        return is3('C', 'O', 'N') || is3('P', 'R', 'N') || is3('A', 'U', 'X') || is3('N', 'U', 'L');
    if (s.size() == 4) {
        UChar d = s[3];
        bool suffix = (d >= '1' && d <= '9') || d == 0xB9 || d == 0xB2 || d == 0xB3;
        return suffix && (is3('C', 'O', 'M') || is3('L', 'P', 'T'));
    }
    return false;
}

// StringPrototypeSlice(s, start, end) index clamping, for the call sites in lib/path.js that
// can pass negative or out-of-range indices.
template<typename C>
static ALWAYS_INLINE std::span<const C> jsSlice(std::span<const C> s, Index start, Index end)
{
    const Index len = static_cast<Index>(s.size());
    if (start < 0)
        start = std::max<Index>(len + start, 0);
    else
        start = std::min(start, len);
    if (end < 0)
        end = std::max<Index>(len + end, 0);
    else
        end = std::min(end, len);
    if (end <= start)
        return {};
    return s.subspan(start, end - start);
}

template<typename C>
static ALWAYS_INLINE Index indexOf(std::span<const C> s, LChar ch, Index from = 0)
{
    size_t found = WTF::find(s, static_cast<C>(ch), static_cast<size_t>(from));
    return found == notFound ? -1 : static_cast<Index>(found);
}

template<typename A, typename B>
static ALWAYS_INLINE bool spanEquals(std::span<const A> a, std::span<const B> b)
{
    if (a.size() != b.size())
        return false;
    if constexpr (std::is_same_v<A, B>)
        return !a.size() || !memcmp(a.data(), b.data(), a.size() * sizeof(A));
    else {
        for (size_t i = 0; i < a.size(); ++i) {
            if (a[i] != b[i])
                return false;
        }
        return true;
    }
}

template<typename D, typename S>
static ALWAYS_INLINE D* copyChars(D* dst, std::span<const S> src)
{
    StringImpl::copyCharacters(std::span<D>(dst, src.size()), src);
    return dst + src.size();
}

template<typename D>
static ALWAYS_INLINE D* copyChars(D* dst, StringView src)
{
    src.getCharacters(std::span<D>(dst, src.length()));
    return dst + src.length();
}

template<typename C>
static ALWAYS_INLINE C* reserve(PathBuffer<C>& buffer, size_t size)
{
    buffer.resize(size);
    return buffer.mutableSpan().data();
}

template<typename C>
static ALWAYS_INLINE std::span<const C> spanOf(const PathBuffer<C>& buffer, const C* begin, const C* end)
{
    ASSERT(begin >= buffer.span().data() && end <= buffer.span().data() + buffer.size());
    return { begin, static_cast<size_t>(end - begin) };
}

// A string argument resolved to a flat view. After viewOf() the JSString is either non-rope
// or a substring rope, so jsSubstringOfResolved() may be used on it.
struct Input {
    JSString* string { nullptr };
    StringView view {};

    unsigned length() const { return view.length(); }
    bool is8Bit() const { return view.is8Bit(); }
    UChar operator[](unsigned i) const { return view[i]; }
};

static ALWAYS_INLINE bool viewOf(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, Input& out)
{
    out.string = asString(value);
    auto data = out.string->view(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    out.view = data.data;
    return true;
}

template<typename F>
static ALWAYS_INLINE decltype(auto) withChars(const StringView& view, F&& f)
{
    if (view.is8Bit())
        return f(view.span8());
    return f(view.span16());
}

template<typename Span> using CharOf = std::remove_const_t<typename Span::element_type>;

static ALWAYS_INLINE JSString* substring(VM& vm, const Input& input, Index start, Index end)
{
    ASSERT(start >= 0 && end >= start && end <= static_cast<Index>(input.length()));
    return jsSubstringOfResolved(vm, input.string, static_cast<unsigned>(start), static_cast<unsigned>(end - start));
}

template<typename C>
static JSValue toJS(JSGlobalObject* globalObject, ThrowScope& scope, std::span<const C> chars)
{
    VM& vm = globalObject->vm();
    if (chars.empty())
        return jsEmptyString(vm);
    if (chars.size() == 1 && chars[0] <= maxSingleCharacterString)
        return vm.smallStrings.singleCharacterString(static_cast<unsigned char>(chars[0]));
    if (chars.size() > static_cast<size_t>(StringImpl::MaxLength)) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    return jsString(vm, String(StringImpl::create(chars)));
}

// When the result turns out to be identical to an input, hand back that cell instead of
// allocating a copy.
template<typename C>
static JSValue toJSReusing(JSGlobalObject* globalObject, ThrowScope& scope, std::span<const C> chars, const Input& input)
{
    if (input.string && input.length() == chars.size()) {
        bool same = withChars(input.view, [&](auto in) -> bool {
            if constexpr (std::is_same_v<CharOf<decltype(in)>, C>) {
                if (in.data() == chars.data())
                    return true;
            }
            return spanEquals(chars, in);
        });
        if (same)
            return input.string;
    }
    return toJS(globalObject, scope, chars);
}

static ALWAYS_INLINE JSString* dotString(VM& vm) { return vm.smallStrings.singleCharacterString('.'); }

// process.cwd()
static ALWAYS_INLINE bool getCwd(JSGlobalObject* globalObject, ThrowScope& scope, Input& out)
{
    JSValue cwd = defaultGlobalObject(globalObject)->processObject()->cachedCwd();
    if (!cwd) [[unlikely]] {
        cwd = JSValue::decode(Process__getCachedCwd(globalObject));
        RETURN_IF_EXCEPTION(scope, false);
    }
    return viewOf(globalObject, scope, cwd, out);
}

// Index of the first path separator in p[i, len), or len. Scans a machine word at a time.
template<bool isWindows, typename C>
static ALWAYS_INLINE size_t findSeparator(const C* p, size_t i, size_t len)
{
    using Word = uint64_t;
    constexpr size_t charsPerWord = sizeof(Word) / sizeof(C);
    constexpr unsigned bitsPerChar = 8 * sizeof(C);
    constexpr Word ones = sizeof(C) == 1 ? 0x0101010101010101ull : 0x0001000100010001ull;
    constexpr Word highs = ones << (bitsPerChar - 1);
    while (i + charsPerWord <= len) {
        Word w;
        memcpy(&w, p + i, sizeof(Word));
        // Exact for the lowest matching lane, which is the only one consulted (little-endian).
        Word x = w ^ (ones * CHAR_FORWARD_SLASH);
        Word found = (x - ones) & ~x & highs;
        if constexpr (isWindows) {
            Word y = w ^ (ones * CHAR_BACKWARD_SLASH);
            found |= (y - ones) & ~y & highs;
        }
        if (found)
            return i + std::countr_zero(found) / bitsPerChar;
        i += charsPerWord;
    }
    while (i < len && !isPathSeparator<isWindows>(p[i]))
        i++;
    return i;
}

// Length of the common prefix of a[0, n) and b[0, n).
template<typename C>
static ALWAYS_INLINE size_t commonPrefixLength(const C* a, const C* b, size_t n)
{
    using Word = uint64_t;
    constexpr size_t charsPerWord = sizeof(Word) / sizeof(C);
    size_t i = 0;
    while (i + charsPerWord <= n) {
        Word wa, wb;
        memcpy(&wa, a + i, sizeof(Word));
        memcpy(&wb, b + i, sizeof(Word));
        if (Word diff = wa ^ wb)
            return i + std::countr_zero(diff) / (8 * sizeof(C));
        i += charsPerWord;
    }
    while (i < n && a[i] == b[i])
        i++;
    return i;
}

// Resolves . and .. elements in a path with directory names.
// This is normalizeString() from lib/path.js restructured to scan a segment at a time
// instead of a code unit at a time; the observable behaviour is identical.
// `res` must have room for path.size() characters; returns the length written.
template<bool isWindows, typename C>
static size_t normalizeString(std::span<const C> path, bool allowAboveRoot, C* res)
{
    constexpr C sep = separator<isWindows>;
    const C* const p = path.data();
    const size_t len = path.size();
    size_t resLen = 0;
    size_t lastSegmentLength = 0;
    size_t i = 0;
    while (i <= len) {
        const size_t segment = i;
        i = findSeparator<isWindows>(p, i, len);
        const size_t segmentLength = i - segment;
        // `i` is now at a separator or at `len`; step over it for the next iteration.
        i++;

        if (segmentLength == 0 || (segmentLength == 1 && p[segment] == CHAR_DOT)) {
            // NOOP
        } else if (segmentLength == 2 && p[segment] == CHAR_DOT && p[segment + 1] == CHAR_DOT) {
            if (resLen < 2 || lastSegmentLength != 2 || res[resLen - 1] != CHAR_DOT || res[resLen - 2] != CHAR_DOT) {
                if (resLen > 2) {
                    // const lastSlashIndex = res.length - lastSegmentLength - 1;
                    if (resLen == lastSegmentLength) {
                        // lastSlashIndex === -1
                        resLen = 0;
                        lastSegmentLength = 0;
                    } else {
                        resLen = resLen - lastSegmentLength - 1;
                        // lastSegmentLength = res.length - 1 - StringPrototypeLastIndexOf(res, separator);
                        size_t k = resLen;
                        while (k > 0 && res[k - 1] != sep)
                            --k;
                        lastSegmentLength = resLen - k;
                    }
                    continue;
                } else if (resLen != 0) {
                    resLen = 0;
                    lastSegmentLength = 0;
                    continue;
                }
            }
            if (allowAboveRoot) {
                if (resLen > 0)
                    res[resLen++] = sep;
                res[resLen++] = CHAR_DOT;
                res[resLen++] = CHAR_DOT;
                lastSegmentLength = 2;
            }
        } else {
            if (resLen > 0)
                res[resLen++] = sep;
            const C* from = p + segment;
            C* to = res + resLen;
            if (segmentLength <= 16) {
                for (size_t k = 0; k < segmentLength; ++k)
                    to[k] = from[k];
            } else
                memcpy(to, from, segmentLength * sizeof(C));
            resLen += segmentLength;
            lastSegmentLength = segmentLength;
        }
    }
    return resLen;
}

// ───────────────────────────────── posix ─────────────────────────────────

namespace Posix {

// posixCwd(): on Windows hosts, converts separators and strips the drive.
static bool cwd(JSGlobalObject* globalObject, ThrowScope& scope, Input& out, PathBuffer<UChar>& storage)
{
    if (!getCwd(globalObject, scope, out))
        return false;
#if OS(WINDOWS)
    const unsigned len = out.length();
    UChar* p = reserve(storage, len);
    out.view.getCharacters(std::span<UChar>(p, len));
    Index firstSlash = -1;
    for (unsigned i = 0; i < len; ++i) {
        if (p[i] == CHAR_BACKWARD_SLASH)
            p[i] = CHAR_FORWARD_SLASH;
        if (firstSlash == -1 && p[i] == CHAR_FORWARD_SLASH)
            firstSlash = i;
    }
    out.view = StringView(jsSlice(std::span<const UChar>(p, len), firstSlash, len));
    out.string = nullptr;
#else
    UNUSED_PARAM(storage);
#endif
    return true;
}

// resolve() once the arguments have been reduced to the strings that participate, in call
// order (cwd first when it was consulted).
template<typename C>
static std::span<const C> resolve(std::span<const StringView> parts, PathBuffer<C>& out)
{
    size_t joinedLen = 0;
    for (auto& part : parts)
        joinedLen += part.length() + 1;

    PathBuffer<C> joined;
    C* p = reserve(joined, joinedLen);
    for (auto& part : parts) {
        p = copyChars(p, part);
        *p++ = CHAR_FORWARD_SLASH;
    }

    const bool resolvedAbsolute = !parts.empty() && parts[0].length() && parts[0][0] == CHAR_FORWARD_SLASH;

    // Normalize the path
    C* res = reserve(out, joinedLen + 1);
    res[0] = CHAR_FORWARD_SLASH;
    size_t len = normalizeString<false, C>(joined.span(), !resolvedAbsolute, res + 1);

    if (resolvedAbsolute)
        return { res, len + 1 };
    if (len > 0)
        return { res + 1, len };
    res[0] = CHAR_DOT;
    return { res, 1 };
}

// resolve(path) for a single already-validated string. `cwd` must be provided unless `path`
// is absolute.
template<typename C>
static std::span<const C> resolve(StringView path, const Input* cwd, PathBuffer<C>& out)
{
    StringView parts[2];
    unsigned n = 0;
    if (!path.length() || path[0] != CHAR_FORWARD_SLASH)
        parts[n++] = cwd->view;
    if (path.length())
        parts[n++] = path;
    return resolve<C>(std::span<const StringView>(parts, n), out);
}

static ALWAYS_INLINE bool needsCwd(StringView path)
{
    return !path.length() || path[0] != CHAR_FORWARD_SLASH;
}

template<typename C>
static std::span<const C> normalize(std::span<const C> path, PathBuffer<C>& out)
{
    // Caller handles path.length === 0.
    const bool isAbsolute = path[0] == CHAR_FORWARD_SLASH;
    const bool trailingSeparator = path[path.size() - 1] == CHAR_FORWARD_SLASH;

    // Normalize the path
    C* res = reserve(out, path.size() + 2);
    res[0] = CHAR_FORWARD_SLASH;
    size_t len = normalizeString<false, C>(path, !isAbsolute, res + 1);

    if (len == 0) {
        if (isAbsolute)
            return { res, 1 };
        res[0] = CHAR_DOT;
        res[1] = CHAR_FORWARD_SLASH;
        return { res, trailingSeparator ? 2u : 1u };
    }
    if (trailingSeparator)
        res[1 + len++] = CHAR_FORWARD_SLASH;

    if (isAbsolute)
        return { res, len + 1 };
    return { res + 1, len };
}

template<typename C>
static std::span<const C> join(std::span<const StringView> paths, PathBuffer<C>& joined, PathBuffer<C>& out)
{
    // Caller has removed empty arguments and handled the none-left case.
    size_t joinedLen = paths.size() - 1;
    for (auto& path : paths)
        joinedLen += path.length();
    C* p = reserve(joined, joinedLen);
    for (size_t i = 0; i < paths.size(); ++i) {
        if (i)
            *p++ = CHAR_FORWARD_SLASH;
        p = copyChars(p, paths[i]);
    }
    return normalize<C>(joined.span(), out);
}

template<typename C>
static JSValue relative(JSGlobalObject* globalObject, ThrowScope& scope, StringView fromIn, StringView toIn, const Input* cwd)
{
    VM& vm = globalObject->vm();

    // Trim leading forward slashes.
    PathBuffer<C> fromBuf, toBuf;
    const std::span<const C> from = resolve<C>(fromIn, cwd, fromBuf);
    const std::span<const C> to = resolve<C>(toIn, cwd, toBuf);

    if (spanEquals(from, to))
        return jsEmptyString(vm);

    const Index fromStart = 1;
    const Index fromEnd = from.size();
    const Index fromLen = fromEnd - fromStart;
    const Index toStart = 1;
    const Index toLen = static_cast<Index>(to.size()) - toStart;

    // Compare paths to find the longest common path from root
    const Index length = (fromLen < toLen ? fromLen : toLen);
    Index i = commonPrefixLength(from.data() + fromStart, to.data() + toStart, length);
    Index lastCommonSep = i;
    while (--lastCommonSep >= 0 && from[fromStart + lastCommonSep] != CHAR_FORWARD_SLASH) {
    }
    if (i == length) {
        if (toLen > length) {
            if (to[toStart + i] == CHAR_FORWARD_SLASH) {
                // We get here if `from` is the exact base path for `to`.
                // For example: from='/foo/bar'; to='/foo/bar/baz'
                return toJS(globalObject, scope, to.subspan(toStart + i + 1));
            }
            if (i == 0) {
                // We get here if `from` is the root
                // For example: from='/'; to='/foo'
                return toJS(globalObject, scope, to.subspan(toStart + i));
            }
        } else if (fromLen > length) {
            if (from[fromStart + i] == CHAR_FORWARD_SLASH) {
                // We get here if `to` is the exact base path for `from`.
                // For example: from='/foo/bar/baz'; to='/foo/bar'
                lastCommonSep = i;
            } else if (i == 0) {
                // We get here if `to` is the root.
                // For example: from='/foo/bar'; to='/'
                lastCommonSep = 0;
            }
        }
    }

    // Generate the relative path based on the path difference between `to`
    // and `from`.
    size_t up = 0;
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
        if (i == fromEnd || from[i] == CHAR_FORWARD_SLASH)
            up++;
    }

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts.
    const auto rest = to.subspan(toStart + lastCommonSep);
    PathBuffer<C> out;
    C* const begin = reserve(out, up * 3 + rest.size());
    C* p = begin;
    for (size_t k = 0; k < up; ++k) {
        if (k)
            *p++ = CHAR_FORWARD_SLASH;
        *p++ = CHAR_DOT;
        *p++ = CHAR_DOT;
    }
    p = copyChars(p, rest);
    return toJS(globalObject, scope, spanOf(out, begin, p));
}

static JSValue dirname(VM& vm, const Input& path)
{
    // Caller handles path.length === 0.
    return withChars(path.view, [&](auto p) -> JSValue {
        const Index len = p.size();
        const bool hasRoot = p[0] == CHAR_FORWARD_SLASH;
        Index end = -1;
        bool matchedSlash = true;
        for (Index i = len - 1; i >= 1; --i) {
            if (p[i] == CHAR_FORWARD_SLASH) {
                if (!matchedSlash) {
                    end = i;
                    break;
                }
            } else {
                // We saw the first non-path separator
                matchedSlash = false;
            }
        }

        if (end == -1)
            return hasRoot ? vm.smallStrings.singleCharacterString('/') : dotString(vm);
        if (hasRoot && end == 1)
            return jsNontrivialString(vm, "//"_s);
        return substring(vm, path, 0, end);
    });
}

static JSValue basename(VM& vm, const Input& path, const Input* suffix)
{
    return withChars(path.view, [&](auto p) -> JSValue {
        Index start = 0;
        Index end = -1;
        bool matchedSlash = true;
        const Index pathLength = p.size();

        if (suffix && suffix->length() > 0 && static_cast<Index>(suffix->length()) <= pathLength) {
            return withChars(suffix->view, [&](auto s) -> JSValue {
                if (spanEquals(s, p))
                    return jsEmptyString(vm);
                Index extIdx = static_cast<Index>(s.size()) - 1;
                Index firstNonSlashEnd = -1;
                for (Index i = pathLength - 1; i >= 0; --i) {
                    const UChar code = p[i];
                    if (code == CHAR_FORWARD_SLASH) {
                        // If we reached a path separator that was not part of a set of path
                        // separators at the end of the string, stop now
                        if (!matchedSlash) {
                            start = i + 1;
                            break;
                        }
                    } else {
                        if (firstNonSlashEnd == -1) {
                            // We saw the first non-path separator, remember this index in case
                            // we need it if the extension ends up not matching
                            matchedSlash = false;
                            firstNonSlashEnd = i + 1;
                        }
                        if (extIdx >= 0) {
                            // Try to match the explicit extension
                            if (code == s[extIdx]) {
                                if (--extIdx == -1) {
                                    // We matched the extension, so mark this as the end of our path
                                    // component
                                    end = i;
                                }
                            } else {
                                // Extension does not match, so our result is the entire path
                                // component
                                extIdx = -1;
                                end = firstNonSlashEnd;
                            }
                        }
                    }
                }

                if (start == end)
                    end = firstNonSlashEnd;
                else if (end == -1)
                    end = pathLength;
                return substring(vm, path, start, end);
            });
        }
        for (Index i = pathLength - 1; i >= 0; --i) {
            if (p[i] == CHAR_FORWARD_SLASH) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else if (end == -1) {
                // We saw the first non-path separator, mark this as the end of our
                // path component
                matchedSlash = false;
                end = i + 1;
            }
        }

        if (end == -1)
            return jsEmptyString(vm);
        return substring(vm, path, start, end);
    });
}

static JSValue extname(VM& vm, const Input& path)
{
    return withChars(path.view, [&](auto p) -> JSValue {
        Index startDot = -1;
        Index startPart = 0;
        Index end = -1;
        bool matchedSlash = true;
        // Track the state of characters (if any) we see before our first dot and
        // after any path separator we find
        Index preDotState = 0;
        for (Index i = static_cast<Index>(p.size()) - 1; i >= 0; --i) {
            const UChar code = p[i];
            if (code == CHAR_FORWARD_SLASH) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end == -1) {
                // We saw the first non-path separator, mark this as the end of our
                // extension
                matchedSlash = false;
                end = i + 1;
            }
            if (code == CHAR_DOT) {
                // If this is our first dot, mark it as the start of our extension
                if (startDot == -1)
                    startDot = i;
                else if (preDotState != 1)
                    preDotState = 1;
            } else if (startDot != -1) {
                // We saw a non-dot and non-path separator before our dot, so we should
                // have a good chance at having a non-empty extension
                preDotState = -1;
            }
        }

        if (startDot == -1 || end == -1 ||
            // We saw a non-dot character immediately before the dot
            preDotState == 0 ||
            // The (right-most) trimmed path component is exactly '..'
            (preDotState == 1 && startDot == end - 1 && startDot == startPart + 1)) {
            return jsEmptyString(vm);
        }
        return substring(vm, path, startDot, end);
    });
}

struct Parsed {
    JSValue root, dir, base, ext, name;
};

static void parse(VM& vm, const Input& path, Parsed& ret)
{
    // Caller handles path.length === 0 and pre-fills every field with ''.
    withChars(path.view, [&](auto p) {
        const bool isAbsolute = p[0] == CHAR_FORWARD_SLASH;
        Index start;
        if (isAbsolute) {
            ret.root = vm.smallStrings.singleCharacterString('/');
            start = 1;
        } else {
            start = 0;
        }
        Index startDot = -1;
        Index startPart = 0;
        Index end = -1;
        bool matchedSlash = true;
        Index i = static_cast<Index>(p.size()) - 1;

        // Track the state of characters (if any) we see before our first dot and
        // after any path separator we find
        Index preDotState = 0;

        // Get non-dir info
        for (; i >= start; --i) {
            const UChar code = p[i];
            if (code == CHAR_FORWARD_SLASH) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end == -1) {
                // We saw the first non-path separator, mark this as the end of our
                // extension
                matchedSlash = false;
                end = i + 1;
            }
            if (code == CHAR_DOT) {
                // If this is our first dot, mark it as the start of our extension
                if (startDot == -1)
                    startDot = i;
                else if (preDotState != 1)
                    preDotState = 1;
            } else if (startDot != -1) {
                // We saw a non-dot and non-path separator before our dot, so we should
                // have a good chance at having a non-empty extension
                preDotState = -1;
            }
        }

        if (end != -1) {
            const Index start = startPart == 0 && isAbsolute ? 1 : startPart;
            if (startDot == -1 ||
                // We saw a non-dot character immediately before the dot
                preDotState == 0 ||
                // The (right-most) trimmed path component is exactly '..'
                (preDotState == 1 && startDot == end - 1 && startDot == startPart + 1)) {
                ret.base = ret.name = substring(vm, path, start, end);
            } else {
                ret.name = substring(vm, path, start, startDot);
                ret.base = substring(vm, path, start, end);
                ret.ext = substring(vm, path, startDot, end);
            }
        }

        if (startPart > 0)
            ret.dir = substring(vm, path, 0, startPart - 1);
        else if (isAbsolute)
            ret.dir = ret.root;
    });
}

} // namespace Posix

// ───────────────────────────────── win32 ─────────────────────────────────

namespace Win32 {

static constexpr bool W = true;

// The `device` string computed while matching a root in resolve()/normalize(). It is always
// one of a handful of shapes assembled from slices of `path`, so record the shape and
// materialize on demand.
template<typename C>
struct Device {
    enum class Kind : uint8_t {
        None, // '' in resolve(), undefined in normalize()
        Drive, // path.slice(0, 2)                              e.g. C:
        Namespace, // `\\${firstPart}` where firstPart is . or ?    e.g. \\.
        UNC, // `\\${firstPart}\${path.slice(last, j)}`         e.g. \\server\share
        Reserved, // path.slice(a0, a1)                          e.g. CON:
        ReservedNamespace, // `\\?\${path.slice(a0, a1)}`       e.g. \\?\COM1:
    };
    Kind kind { Kind::None };
    unsigned a0 { 0 }, a1 { 0 }, b0 { 0 }, b1 { 0 };
    std::span<const C> path;

    bool isNone() const { return kind == Kind::None; }

    size_t length() const
    {
        switch (kind) {
        case Kind::None:
            return 0;
        case Kind::Drive:
            return 2;
        case Kind::Namespace:
            return 3;
        case Kind::UNC:
            return 2 + (a1 - a0) + 1 + (b1 - b0);
        case Kind::Reserved:
            return a1 - a0;
        case Kind::ReservedNamespace:
            return 4 + (a1 - a0);
        }
        return 0;
    }

    template<typename D> D* writeTo(D* out) const
    {
        switch (kind) {
        case Kind::None:
            return out;
        case Kind::Drive:
            *out++ = path[0];
            *out++ = path[1];
            return out;
        case Kind::Namespace:
            *out++ = CHAR_BACKWARD_SLASH;
            *out++ = CHAR_BACKWARD_SLASH;
            *out++ = path[2];
            return out;
        case Kind::UNC:
            *out++ = CHAR_BACKWARD_SLASH;
            *out++ = CHAR_BACKWARD_SLASH;
            out = copyChars(out, path.subspan(a0, a1 - a0));
            *out++ = CHAR_BACKWARD_SLASH;
            return copyChars(out, path.subspan(b0, b1 - b0));
        case Kind::ReservedNamespace:
            *out++ = CHAR_BACKWARD_SLASH;
            *out++ = CHAR_BACKWARD_SLASH;
            *out++ = CHAR_QUESTION_MARK;
            *out++ = CHAR_BACKWARD_SLASH;
            [[fallthrough]];
        case Kind::Reserved:
            return copyChars(out, path.subspan(a0, a1 - a0));
        }
        return out;
    }
};

// StringPrototypeToLowerCase(a) === StringPrototypeToLowerCase(b)
template<typename A, typename B>
static bool equalsCaseFolded(std::span<const A> a, std::span<const B> b)
{
    if (charactersAreAllASCII(a) && charactersAreAllASCII(b)) [[likely]]
        return WTF::equalIgnoringASCIICase(a, b);
    return String(a).convertToLowercaseWithoutLocale() == String(b).convertToLowercaseWithoutLocale();
}

// The "Try to match a root" prologue shared by resolve() and normalize().
template<typename C>
struct Root {
    unsigned rootEnd { 0 };
    bool isAbsolute { false };
    Device<C> device;
    // normalize()'s "We matched a UNC root only" early return.
    bool uncRootOnly { false };
    unsigned firstPartStart { 0 }, firstPartEnd { 0 }, last { 0 };
};

enum class RootMode {
    Resolve,
    Normalize,
};

template<RootMode mode, typename C>
static ALWAYS_INLINE Root<C> matchRoot(std::span<const C> path)
{
    using Kind = typename Device<C>::Kind;
    Root<C> r;
    r.device.path = path;
    const unsigned len = path.size();
    const UChar code = path[0];

    // Caller handles len <= 1 for normalize.
    if (mode == RootMode::Resolve && len == 1) {
        if (isPathSeparator<W>(code)) {
            // `path` contains just a path separator
            r.rootEnd = 1;
            r.isAbsolute = true;
        }
        return r;
    }
    if (isPathSeparator<W>(code)) {
        // Possible UNC root

        // If we started with a separator, we know we at least have an
        // absolute path of some kind (UNC or otherwise)
        r.isAbsolute = true;

        if (isPathSeparator<W>(path[1])) {
            // Matched double path separator at beginning
            unsigned j = 2;
            unsigned last = j;
            // Match 1 or more non-path separators
            while (j < len && !isPathSeparator<W>(path[j])) {
                j++;
            }
            if (j < len && j != last) {
                r.firstPartStart = last;
                r.firstPartEnd = j;
                const bool firstPartIsNamespace = (j - last == 1) && (path[last] == CHAR_DOT || path[last] == CHAR_QUESTION_MARK);
                // Matched!
                last = j;
                // Match 1 or more path separators
                while (j < len && isPathSeparator<W>(path[j])) {
                    j++;
                }
                if (j < len && j != last) {
                    // Matched!
                    last = j;
                    // Match 1 or more non-path separators
                    while (j < len && !isPathSeparator<W>(path[j])) {
                        j++;
                    }
                    if (j == len || j != last) {
                        if (firstPartIsNamespace) {
                            // We matched a device root (e.g. \\\\.\\PHYSICALDRIVE0)
                            r.device.kind = Kind::Namespace;
                            r.rootEnd = 4;
                        } else if (mode == RootMode::Normalize && j == len) {
                            // We matched a UNC root only
                            r.uncRootOnly = true;
                            r.last = last;
                        } else {
                            // We matched a UNC root
                            r.device.kind = Kind::UNC;
                            r.device.a0 = r.firstPartStart;
                            r.device.a1 = r.firstPartEnd;
                            r.device.b0 = last;
                            r.device.b1 = j;
                            r.rootEnd = j;
                        }
                    }
                }
            }
        } else {
            r.rootEnd = 1;
        }
    } else if (isWindowsDeviceRoot(code) && path[1] == CHAR_COLON) {
        // Possible device root
        r.device.kind = Kind::Drive;
        r.rootEnd = 2;
        if (len > 2 && isPathSeparator<W>(path[2])) {
            // Treat separator following drive name as an absolute path
            // indicator
            r.isAbsolute = true;
            r.rootEnd = 3;
        }
    }
    return r;
}

struct ResolvePart {
    StringView view;
    unsigned rootEnd;
};

struct ResolveState {
    Vector<ResolvePart, 16> parts; // in visit (reverse) order
    Vector<UChar, 32> device;
    bool resolvedAbsolute { false };
    bool all8Bit { true };
    // "Fast path for current directory": the cwd string to return as-is.
    bool returnCwd { false };
    Input cwd;
};

template<typename C>
static void appendDevice(Vector<UChar, 32>& out, const Device<C>& device)
{
    size_t start = out.size();
    out.grow(start + device.length());
    device.writeTo(out.mutableSpan().data() + start);
}

// path = process.env[`=${resolvedDevice}`] || process.cwd(), and the drive check that follows.
static bool driveCwd(JSGlobalObject* globalObject, ThrowScope& scope, std::span<const UChar> resolvedDevice, Input& out, PathBuffer<UChar>& storage)
{
    bool found = false;
#if OS(WINDOWS)
    {
        Vector<wchar_t, 40> key;
        key.append(L'=');
        for (UChar c : resolvedDevice)
            key.append(static_cast<wchar_t>(c));
        key.append(0);
        DWORD n = GetEnvironmentVariableW(key.span().data(), nullptr, 0);
        if (n > 1) {
            UChar* p = reserve(storage, n);
            DWORD written = GetEnvironmentVariableW(key.span().data(), reinterpret_cast<wchar_t*>(p), n);
            if (written > 0 && written < n) {
                out.string = nullptr;
                out.view = StringView(std::span<const UChar>(p, written));
                found = true;
            }
        }
    }
#else
    if (charactersAreAllASCII(resolvedDevice)) {
        Vector<char, 40> key;
        key.append('=');
        for (UChar c : resolvedDevice)
            key.append(static_cast<char>(c));
        key.append(0);
        if (const char* value = getenv(key.span().data()); value && *value) {
            String s = String::fromUTF8(value);
            if (!s.isNull()) {
                UChar* p = reserve(storage, s.length());
                StringView(s).getCharacters(std::span<UChar>(p, s.length()));
                out.string = nullptr;
                out.view = StringView(std::span<const UChar>(p, s.length()));
                found = true;
            }
        }
    }
#endif
    if (!found) {
        if (!getCwd(globalObject, scope, out))
            return false;
    }

    // Verify that a cwd was found and that it actually points
    // to our drive. If not, default to the drive's root.
    const bool otherDrive = withChars(out.view, [&](auto p) -> bool {
        return p.size() > 2 && p[2] == CHAR_BACKWARD_SLASH && !equalsCaseFolded(jsSlice(p, 0, 2), resolvedDevice);
    });
    if (otherDrive) {
        PathBuffer<UChar> root;
        root.append(resolvedDevice);
        root.append(CHAR_BACKWARD_SLASH);
        storage.swap(root);
        out.string = nullptr;
        out.view = StringView(storage.span());
    }
    return true;
}

// The argument-scanning half of win32.resolve(). `getArg(i, Input&) -> bool` produces
// argument i (running validateString for the JS entry point) or returns false on exception.
template<typename GetArg>
static bool resolveScan(JSGlobalObject* globalObject, ThrowScope& scope, Index argCount, GetArg&& getArg, ResolveState& st, PathBuffer<UChar>& cwdStorage)
{
    for (Index i = argCount - 1; i >= -1; i--) {
        Input path;
        if (i >= 0) {
            if (!getArg(i, path))
                return false;

            // Skip empty entries
            if (path.length() == 0) {
                continue;
            }
        } else if (st.device.isEmpty()) {
            if (!getCwd(globalObject, scope, path))
                return false;
            // Fast path for current directory
            if (argCount == 0 || (argCount == 1 && path.length() && isPathSeparator<W>(path[0]))) {
                bool trivial = argCount == 0;
                if (!trivial) {
                    Input arg;
                    if (!getArg(0, arg))
                        return false;
                    trivial = arg.length() == 0 || (arg.length() == 1 && arg[0] == CHAR_DOT);
                }
                if (trivial) {
                    st.returnCwd = true;
                    st.cwd = path;
                    return true;
                }
            }
        } else {
            // Windows has the concept of drive-specific current working
            // directories. If we've resolved a drive letter but not yet an
            // absolute path, get cwd for that drive, or the process cwd if
            // the drive cwd is not available. We're sure the device is not
            // a UNC path at this points, because UNC paths are always absolute.
            if (!driveCwd(globalObject, scope, st.device.span(), path, cwdStorage))
                return false;
        }

        if (path.length() == 0) [[unlikely]] {
            // An empty process.cwd(): no root, no device, contributes only a separator.
            if (!st.resolvedAbsolute) {
                st.parts.append({ path.view, 0 });
                st.all8Bit &= path.is8Bit();
            }
            continue;
        }

        bool skip = false, stop = false;
        withChars(path.view, [&](auto p) {
            using PC = CharOf<decltype(p)>;
            const Root<PC> root = matchRoot<RootMode::Resolve, PC>(p);

            if (!root.device.isNone()) {
                if (!st.device.isEmpty()) {
                    Vector<UChar, 32> device;
                    appendDevice(device, root.device);
                    if (!equalsCaseFolded(device.span(), st.device.span())) {
                        // This path points to another device so it is not applicable
                        skip = true;
                        return;
                    }
                } else {
                    appendDevice(st.device, root.device);
                    st.all8Bit &= path.is8Bit() || charactersAreAllASCII(st.device.span());
                }
            }

            if (st.resolvedAbsolute) {
                if (!st.device.isEmpty())
                    stop = true;
            } else {
                st.parts.append({ path.view, root.rootEnd });
                st.all8Bit &= path.is8Bit();
                st.resolvedAbsolute = root.isAbsolute;
                if (root.isAbsolute && !st.device.isEmpty()) {
                    stop = true;
                }
            }
        });
        if (skip)
            continue;
        if (stop)
            break;
    }
    return true;
}

// The string-building half of win32.resolve().
template<typename C>
static std::span<const C> resolveBuild(const ResolveState& st, PathBuffer<C>& out)
{
    size_t tailLen = 0;
    for (auto& part : st.parts)
        tailLen += part.view.length() - part.rootEnd + 1;

    PathBuffer<C> tail;
    C* p = reserve(tail, tailLen);
    for (size_t k = st.parts.size(); k--;) {
        auto& part = st.parts[k];
        p = copyChars(p, part.view.substring(part.rootEnd));
        *p++ = CHAR_BACKWARD_SLASH;
    }

    // At this point the path should be resolved to a full absolute path,
    // but handle relative paths to be safe (might happen when process.cwd()
    // fails)

    const size_t deviceLen = st.device.size();
    C* res = reserve(out, deviceLen + 1 + tailLen + 1);
    C* q = copyChars(res, st.device.span());
    if (st.resolvedAbsolute)
        *q++ = CHAR_BACKWARD_SLASH;

    // Normalize the tail path
    size_t len = normalizeString<W, C>(tail.span(), !st.resolvedAbsolute, q);

    size_t total = (q - res) + len;
    if (!total) {
        res[0] = CHAR_DOT;
        total = 1;
    }
    return { res, total };
}

template<typename C>
static std::span<const C> replaceForwardSlashes(std::span<const C> in, PathBuffer<C>& out)
{
    C* p = reserve(out, in.size());
    for (size_t k = 0; k < in.size(); ++k)
        p[k] = in[k] == CHAR_FORWARD_SLASH ? CHAR_BACKWARD_SLASH : in[k];
    return { p, in.size() };
}

// resolve(...paths) for internal callers with already-validated strings. Writes into whichever
// of out8/out16 matches the inputs' width and returns a view over it.
static bool resolve(JSGlobalObject* globalObject, ThrowScope& scope, std::span<const StringView> paths, PathBuffer<LChar>& out8, PathBuffer<UChar>& out16, StringView& result)
{
    ResolveState st;
    PathBuffer<UChar> cwdStorage;
    auto getArg = [&](Index i, Input& out) {
        out.view = paths[i];
        return true;
    };
    if (!resolveScan(globalObject, scope, paths.size(), getArg, st, cwdStorage))
        return false;
    if (st.returnCwd) {
#if OS(WINDOWS)
        result = st.cwd.view;
#else
        // path = StringPrototypeReplace(path, /\//g, '\\');
        result = withChars(st.cwd.view, [&](auto s) -> StringView {
            if constexpr (std::is_same_v<CharOf<decltype(s)>, LChar>)
                return replaceForwardSlashes(s, out8);
            else
                return replaceForwardSlashes(s, out16);
        });
#endif
        return true;
    }
    if (st.all8Bit)
        result = StringView(resolveBuild<LChar>(st, out8));
    else
        result = StringView(resolveBuild<UChar>(st, out16));
    return true;
}

template<typename C>
static std::span<const C> normalize(std::span<const C> path, PathBuffer<C>& out)
{
    using Kind = typename Device<C>::Kind;
    const Index len = path.size();
    // Caller handles len === 0.
    const UChar code = path[0];

    // Try to match a root
    if (len == 1) {
        // `path` contains just a single char, exit early to avoid
        // unnecessary work
        if (code == CHAR_FORWARD_SLASH) {
            C* p = reserve(out, 1);
            p[0] = CHAR_BACKWARD_SLASH;
            return { p, 1 };
        }
        return path;
    }

    Root<C> root = matchRoot<RootMode::Normalize, C>(path);
    Device<C>& device = root.device;
    unsigned rootEnd = root.rootEnd;
    const bool isAbsolute = root.isAbsolute;
    // lib/path.js recomputes StringPrototypeIndexOf(path, ':') at each use; it never changes.
    const Index colonIndex = indexOf(path, CHAR_COLON);

    if (device.kind == Kind::Namespace) {
        // Special case: handle \\?\COM1: or similar reserved device paths
        const auto possibleDevice = jsSlice(path, 4, colonIndex + 1);
        if (isWindowsReservedName(jsSlice(possibleDevice, 0, static_cast<Index>(possibleDevice.size()) - 1))) {
            device.kind = Kind::ReservedNamespace;
            device.a0 = 4;
            device.a1 = 4 + possibleDevice.size();
            rootEnd = 4 + possibleDevice.size();
        }
    } else if (root.uncRootOnly) {
        // We matched a UNC root only
        // Return the normalized version of the UNC root since there
        // is nothing left to process
        const auto firstPart = path.subspan(root.firstPartStart, root.firstPartEnd - root.firstPartStart);
        const auto rest = path.subspan(root.last);
        C* const begin = reserve(out, 2 + firstPart.size() + 1 + rest.size() + 1);
        C* p = begin;
        *p++ = CHAR_BACKWARD_SLASH;
        *p++ = CHAR_BACKWARD_SLASH;
        p = copyChars(p, firstPart);
        *p++ = CHAR_BACKWARD_SLASH;
        p = copyChars(p, rest);
        *p++ = CHAR_BACKWARD_SLASH;
        return spanOf(out, begin, p);
    } else if (!isPathSeparator<W>(code)) {
        if (colonIndex > 0) {
            if (device.kind == Kind::Drive) {
                // isWindowsDeviceRoot(code) && colonIndex === 1, handled by matchRoot()
            } else if (isWindowsReservedName(path.first(colonIndex))) {
                device.kind = Kind::Reserved;
                device.a0 = 0;
                device.a1 = colonIndex + 1;
                rootEnd = colonIndex + 1;
            }
        }
    }

    // Output layout: [.\][device][\][tail][\] — the tail is written first at a fixed offset
    // and whichever prefix applies is then written immediately before it.
    const size_t deviceLen = device.length();
    const size_t tailStart = 2 + deviceLen + 1;
    C* const buf = reserve(out, tailStart + (len - rootEnd) + 2);
    C* const tail = buf + tailStart;
    size_t tailLen = rootEnd < len ? normalizeString<W, C>(path.subspan(rootEnd), !isAbsolute, tail) : 0;
    if (tailLen == 0 && !isAbsolute)
        tail[tailLen++] = CHAR_DOT;
    if (tailLen > 0 && isPathSeparator<W>(path[len - 1]))
        tail[tailLen++] = CHAR_BACKWARD_SLASH;

    C* head = tail;
    auto emit = [&]() -> std::span<const C> { return spanOf(out, head, tail + tailLen); };
    auto prependDotSlash = [&] { *--head = CHAR_BACKWARD_SLASH; *--head = CHAR_DOT; };
    auto prependDevice = [&] { head -= deviceLen; device.writeTo(head); };

    if (!isAbsolute && device.isNone() && colonIndex != -1) {
        // If the original path was not absolute and if we have not been able to
        // resolve it relative to a particular device, we need to ensure that the
        // `tail` has not become something that Windows might interpret as an
        // absolute path. See CVE-2024-36139.
        if (tailLen >= 2 && isWindowsDeviceRoot(tail[0]) && tail[1] == CHAR_COLON) {
            prependDotSlash();
            return emit();
        }
        Index index = colonIndex;

        do {
            if (index == len - 1 || isPathSeparator<W>(path[index + 1])) {
                prependDotSlash();
                return emit();
            }
        } while ((index = indexOf(path, CHAR_COLON, index + 1)) != -1);
    }
    if (isWindowsReservedName(jsSlice(path, 0, colonIndex))) {
        prependDevice();
        prependDotSlash();
        return emit();
    }
    if (device.isNone()) {
        if (isAbsolute)
            *--head = CHAR_BACKWARD_SLASH;
        return emit();
    }
    if (isAbsolute)
        *--head = CHAR_BACKWARD_SLASH;
    prependDevice();
    return emit();
}

template<typename C>
static std::span<const C> join(std::span<const StringView> paths, PathBuffer<C>& joinedBuf, PathBuffer<C>& out)
{
    // Caller has removed empty arguments and handled the none-left case.
    size_t joinedLen = paths.size() - 1;
    for (auto& path : paths)
        joinedLen += path.length();
    C* base = reserve(joinedBuf, joinedLen);
    {
        C* p = base;
        for (size_t i = 0; i < paths.size(); ++i) {
            if (i)
                *p++ = CHAR_BACKWARD_SLASH;
            p = copyChars(p, paths[i]);
        }
    }
    std::span<const C> joined(base, joinedLen);
    const StringView firstPart = paths[0];

    // Make sure that the joined path doesn't start with two slashes, because
    // normalize() will mistake it for a UNC path then.
    //
    // This step is skipped when it is very clear that the user actually
    // intended to point at a UNC path. This is assumed when the first
    // non-empty string arguments starts with exactly two slashes followed by
    // at least one more non-slash character.
    //
    // Note that for normalize() to treat a path as a UNC path it needs to
    // have at least 2 components, so we don't filter for that here.
    // This means that the user can use join to construct UNC paths from
    // a server name and a share name; for example:
    //   path.join('//server', 'share') -> '\\\\server\\share\\')
    bool needsReplace = true;
    size_t slashCount = 0;
    if (isPathSeparator<W>(firstPart[0])) {
        ++slashCount;
        const unsigned firstLen = firstPart.length();
        if (firstLen > 1 && isPathSeparator<W>(firstPart[1])) {
            ++slashCount;
            if (firstLen > 2) {
                if (isPathSeparator<W>(firstPart[2]))
                    ++slashCount;
                else {
                    // We matched a UNC path in the first part
                    needsReplace = false;
                }
            }
        }
    }
    if (needsReplace) {
        // Find any more consecutive slashes we need to replace
        while (slashCount < joined.size() && isPathSeparator<W>(joined[slashCount]))
            slashCount++;

        // Replace the slashes if needed
        if (slashCount >= 2) {
            // joined = `\\${StringPrototypeSlice(joined, slashCount)}`
            base[slashCount - 1] = CHAR_BACKWARD_SLASH;
            joined = joined.subspan(slashCount - 1);
        }
    }

    // Skip normalization when reserved device names are present.
    // lib/path.js splits `joined` on backslashes and tests each part up to its first colon;
    // visiting each colon and looking back for the start of its part is equivalent.
    for (Index colon = indexOf(joined, CHAR_COLON); colon != -1; colon = indexOf(joined, CHAR_COLON, colon + 1)) {
        // Reserved names are at most 4 characters, so looking back 5 is enough to decide.
        Index partStart = colon;
        const Index limit = std::max<Index>(0, colon - 5);
        while (partStart > limit && joined[partStart - 1] != CHAR_BACKWARD_SLASH && joined[partStart - 1] != CHAR_COLON)
            partStart--;
        if (partStart > 0 && joined[partStart - 1] != CHAR_BACKWARD_SLASH)
            continue; // an earlier colon in this part, or a part longer than any reserved name
        if (isWindowsReservedName(joined.subspan(partStart, colon - partStart))) {
            // Replace forward slashes with backslashes
            C* p = base + (joined.data() - base);
            for (size_t k = 0, n = joined.size(); k < n; ++k) {
                if (p[k] == CHAR_FORWARD_SLASH)
                    p[k] = CHAR_BACKWARD_SLASH;
            }
            return joined;
        }
    }

    return normalize<C>(joined, out);
}

// StringPrototypeToLowerCase(s)
template<typename C> struct Lowered;
template<> struct Lowered<LChar> {
    PathBuffer<LChar> storage;
    std::span<const LChar> chars;
    explicit Lowered(std::span<const LChar> s)
    {
        LChar* p = reserve(storage, s.size());
        for (size_t i = 0; i < s.size(); ++i) {
            const LChar c = s[i];
            // toLowerCase() restricted to Latin-1 input is 1:1 and stays within Latin-1.
            p[i] = c < 0x80 ? WTF::toASCIILower(c) : ((c >= 0xC0 && c <= 0xDE && c != 0xD7) ? c + 0x20 : c);
        }
        chars = { p, s.size() };
    }
};
template<> struct Lowered<UChar> {
    PathBuffer<UChar> storage;
    String string;
    std::span<const UChar> chars;
    explicit Lowered(std::span<const UChar> s)
    {
        if (charactersAreAllASCII(s)) {
            UChar* p = reserve(storage, s.size());
            for (size_t i = 0; i < s.size(); ++i)
                p[i] = WTF::toASCIILower(s[i]);
            chars = { p, s.size() };
            return;
        }
        string = String(s).convertToLowercaseWithoutLocale();
        if (string.is8Bit()) {
            UChar* p = reserve(storage, string.length());
            StringView(string).getCharacters(std::span<UChar>(p, string.length()));
            chars = { p, string.length() };
        } else
            chars = string.span16();
    }
};

template<typename C>
static JSValue relative(JSGlobalObject* globalObject, ThrowScope& scope, std::span<const C> fromOrig, std::span<const C> toOrig)
{
    VM& vm = globalObject->vm();

    if (spanEquals(fromOrig, toOrig))
        return jsEmptyString(vm);

    const Lowered<C> fromLower(fromOrig);
    const Lowered<C> toLower(toOrig);
    const std::span<const C> from = fromLower.chars;
    const std::span<const C> to = toLower.chars;

    if (spanEquals(from, to))
        return jsEmptyString(vm);

    if (fromOrig.size() != from.size() || toOrig.size() != to.size()) {
        using Split = Vector<std::span<const C>, 32>;
        auto split = [](std::span<const C> s, Split& parts) {
            size_t start = 0;
            for (size_t i = 0; i <= s.size(); ++i) {
                if (i == s.size() || s[i] == CHAR_BACKWARD_SLASH) {
                    parts.append(s.subspan(start, i - start));
                    start = i + 1;
                }
            }
            if (parts.last().empty())
                parts.removeLast();
        };
        Split fromSplit, toSplit;
        split(fromOrig, fromSplit);
        split(toOrig, toSplit);

        const Index fromLen = fromSplit.size();
        const Index toLen = toSplit.size();
        const Index length = fromLen < toLen ? fromLen : toLen;

        Index i;
        for (i = 0; i < length; i++) {
            if (!equalsCaseFolded(fromSplit[i], toSplit[i])) {
                break;
            }
        }

        PathBuffer<C> out;
        // ArrayPrototypeJoin(ArrayPrototypeSlice(toSplit, k), '\\')
        auto joinToSplitFrom = [&](C* p, Index k) {
            for (Index m = k; m < toLen; ++m) {
                if (m != k)
                    *p++ = CHAR_BACKWARD_SLASH;
                p = copyChars(p, toSplit[m]);
            }
            return p;
        };
        if (i == 0) {
            return toJS(globalObject, scope, toOrig);
        } else if (i == length) {
            if (toLen > length) {
                C* const begin = reserve(out, toOrig.size());
                return toJS(globalObject, scope, spanOf(out, begin, joinToSplitFrom(begin, i)));
            }
            if (fromLen > length) {
                const Index ups = fromLen - 1 - i;
                C* const begin = reserve(out, ups * 3 + 2);
                C* p = begin;
                for (Index k = 0; k < ups; ++k) {
                    *p++ = CHAR_DOT;
                    *p++ = CHAR_DOT;
                    *p++ = CHAR_BACKWARD_SLASH;
                }
                *p++ = CHAR_DOT;
                *p++ = CHAR_DOT;
                return toJS(globalObject, scope, spanOf(out, begin, p));
            }
            return jsEmptyString(vm);
        }

        const Index ups = fromLen - i;
        C* const begin = reserve(out, ups * 3 + toOrig.size());
        C* p = begin;
        for (Index k = 0; k < ups; ++k) {
            *p++ = CHAR_DOT;
            *p++ = CHAR_DOT;
            *p++ = CHAR_BACKWARD_SLASH;
        }
        return toJS(globalObject, scope, spanOf(out, begin, joinToSplitFrom(p, i)));
    }

    // Trim any leading backslashes
    Index fromStart = 0;
    while (fromStart < static_cast<Index>(from.size()) && from[fromStart] == CHAR_BACKWARD_SLASH) {
        fromStart++;
    }
    // Trim trailing backslashes (applicable to UNC paths only)
    Index fromEnd = from.size();
    while (fromEnd - 1 > fromStart && from[fromEnd - 1] == CHAR_BACKWARD_SLASH) {
        fromEnd--;
    }
    const Index fromLen = fromEnd - fromStart;

    // Trim any leading backslashes
    Index toStart = 0;
    while (toStart < static_cast<Index>(to.size()) && to[toStart] == CHAR_BACKWARD_SLASH) {
        toStart++;
    }
    // Trim trailing backslashes (applicable to UNC paths only)
    Index toEnd = to.size();
    while (toEnd - 1 > toStart && to[toEnd - 1] == CHAR_BACKWARD_SLASH) {
        toEnd--;
    }
    const Index toLen = toEnd - toStart;

    // Compare paths to find the longest common path from root
    const Index length = fromLen < toLen ? fromLen : toLen;
    Index i = commonPrefixLength(from.data() + fromStart, to.data() + toStart, length);
    Index lastCommonSep = i;
    while (--lastCommonSep >= 0 && from[fromStart + lastCommonSep] != CHAR_BACKWARD_SLASH) {
    }

    // We found a mismatch before the first common path separator was seen, so
    // return the original `to`.
    if (i != length) {
        if (lastCommonSep == -1)
            return toJS(globalObject, scope, toOrig);
    } else {
        if (toLen > length) {
            if (to[toStart + i] == CHAR_BACKWARD_SLASH) {
                // We get here if `from` is the exact base path for `to`.
                // For example: from='C:\\foo\\bar'; to='C:\\foo\\bar\\baz'
                return toJS(globalObject, scope, toOrig.subspan(toStart + i + 1));
            }
            if (i == 2) {
                // We get here if `from` is the device root.
                // For example: from='C:\\'; to='C:\\foo'
                return toJS(globalObject, scope, toOrig.subspan(toStart + i));
            }
        }
        if (fromLen > length) {
            if (from[fromStart + i] == CHAR_BACKWARD_SLASH) {
                // We get here if `to` is the exact base path for `from`.
                // For example: from='C:\\foo\\bar'; to='C:\\foo'
                lastCommonSep = i;
            } else if (i == 2) {
                // We get here if `to` is the device root.
                // For example: from='C:\\foo\\bar'; to='C:\\'
                lastCommonSep = 3;
            }
        }
        if (lastCommonSep == -1)
            lastCommonSep = 0;
    }

    // Generate the relative path based on the path difference between `to` and
    // `from`
    size_t up = 0;
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
        if (i == fromEnd || from[i] == CHAR_BACKWARD_SLASH)
            up++;
    }

    toStart += lastCommonSep;

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts
    if (up > 0) {
        const auto rest = jsSlice(toOrig, toStart, toEnd);
        PathBuffer<C> out;
        C* const begin = reserve(out, up * 3 + rest.size());
        C* p = begin;
        for (size_t k = 0; k < up; ++k) {
            if (k)
                *p++ = CHAR_BACKWARD_SLASH;
            *p++ = CHAR_DOT;
            *p++ = CHAR_DOT;
        }
        p = copyChars(p, rest);
        return toJS(globalObject, scope, spanOf(out, begin, p));
    }

    if (toStart < static_cast<Index>(toOrig.size()) && toOrig[toStart] == CHAR_BACKWARD_SLASH)
        ++toStart;
    return toJS(globalObject, scope, jsSlice(toOrig, toStart, toEnd));
}

static JSValue dirname(VM& vm, const Input& path)
{
    // Caller handles len === 0.
    return withChars(path.view, [&](auto p) -> JSValue {
        const Index len = p.size();
        Index rootEnd = -1;
        Index offset = 0;
        const UChar code = p[0];

        if (len == 1) {
            // `path` contains just a path separator, exit early to avoid
            // unnecessary work or a dot.
            return isPathSeparator<W>(code) ? path.string : dotString(vm);
        }

        // Try to match a root
        if (isPathSeparator<W>(code)) {
            // Possible UNC root

            rootEnd = offset = 1;

            if (isPathSeparator<W>(p[1])) {
                // Matched double path separator at beginning
                Index j = 2;
                Index last = j;
                // Match 1 or more non-path separators
                while (j < len && !isPathSeparator<W>(p[j])) {
                    j++;
                }
                if (j < len && j != last) {
                    // Matched!
                    last = j;
                    // Match 1 or more path separators
                    while (j < len && isPathSeparator<W>(p[j])) {
                        j++;
                    }
                    if (j < len && j != last) {
                        // Matched!
                        last = j;
                        // Match 1 or more non-path separators
                        while (j < len && !isPathSeparator<W>(p[j])) {
                            j++;
                        }
                        if (j == len) {
                            // We matched a UNC root only
                            return path.string;
                        }
                        if (j != last) {
                            // We matched a UNC root with leftovers

                            // Offset by 1 to include the separator after the UNC root to
                            // treat it as a "normal root" on top of a (UNC) root
                            rootEnd = offset = j + 1;
                        }
                    }
                }
            }
            // Possible device root
        } else if (isWindowsDeviceRoot(code) && p[1] == CHAR_COLON) {
            rootEnd = len > 2 && isPathSeparator<W>(p[2]) ? 3 : 2;
            offset = rootEnd;
        }

        Index end = -1;
        bool matchedSlash = true;
        for (Index i = len - 1; i >= offset; --i) {
            if (isPathSeparator<W>(p[i])) {
                if (!matchedSlash) {
                    end = i;
                    break;
                }
            } else {
                // We saw the first non-path separator
                matchedSlash = false;
            }
        }

        if (end == -1) {
            if (rootEnd == -1)
                return dotString(vm);

            end = rootEnd;
        }
        return substring(vm, path, 0, end);
    });
}

static JSValue basename(VM& vm, const Input& path, const Input* suffix)
{
    return withChars(path.view, [&](auto p) -> JSValue {
        Index start = 0;
        Index end = -1;
        bool matchedSlash = true;
        const Index pathLength = p.size();

        // Check for a drive letter prefix so as not to mistake the following
        // path separator as an extra separator at the end of the path that can be
        // disregarded
        if (pathLength >= 2 && isWindowsDeviceRoot(p[0]) && p[1] == CHAR_COLON) {
            start = 2;
        }

        if (suffix && suffix->length() > 0 && static_cast<Index>(suffix->length()) <= pathLength) {
            return withChars(suffix->view, [&](auto s) -> JSValue {
                if (spanEquals(s, p))
                    return jsEmptyString(vm);
                Index extIdx = static_cast<Index>(s.size()) - 1;
                Index firstNonSlashEnd = -1;
                for (Index i = pathLength - 1; i >= start; --i) {
                    const UChar code = p[i];
                    if (isPathSeparator<W>(code)) {
                        // If we reached a path separator that was not part of a set of path
                        // separators at the end of the string, stop now
                        if (!matchedSlash) {
                            start = i + 1;
                            break;
                        }
                    } else {
                        if (firstNonSlashEnd == -1) {
                            // We saw the first non-path separator, remember this index in case
                            // we need it if the extension ends up not matching
                            matchedSlash = false;
                            firstNonSlashEnd = i + 1;
                        }
                        if (extIdx >= 0) {
                            // Try to match the explicit extension
                            if (code == s[extIdx]) {
                                if (--extIdx == -1) {
                                    // We matched the extension, so mark this as the end of our path
                                    // component
                                    end = i;
                                }
                            } else {
                                // Extension does not match, so our result is the entire path
                                // component
                                extIdx = -1;
                                end = firstNonSlashEnd;
                            }
                        }
                    }
                }

                if (start == end)
                    end = firstNonSlashEnd;
                else if (end == -1)
                    end = pathLength;
                return substring(vm, path, start, end);
            });
        }
        for (Index i = pathLength - 1; i >= start; --i) {
            if (isPathSeparator<W>(p[i])) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else if (end == -1) {
                // We saw the first non-path separator, mark this as the end of our
                // path component
                matchedSlash = false;
                end = i + 1;
            }
        }

        if (end == -1)
            return jsEmptyString(vm);
        return substring(vm, path, start, end);
    });
}

static JSValue extname(VM& vm, const Input& path)
{
    return withChars(path.view, [&](auto p) -> JSValue {
        Index start = 0;
        Index startDot = -1;
        Index startPart = 0;
        Index end = -1;
        bool matchedSlash = true;
        // Track the state of characters (if any) we see before our first dot and
        // after any path separator we find
        Index preDotState = 0;
        const Index pathLength = p.size();

        // Check for a drive letter prefix so as not to mistake the following
        // path separator as an extra separator at the end of the path that can be
        // disregarded

        if (pathLength >= 2 && p[1] == CHAR_COLON && isWindowsDeviceRoot(p[0])) {
            start = startPart = 2;
        }

        for (Index i = pathLength - 1; i >= start; --i) {
            const UChar code = p[i];
            if (isPathSeparator<W>(code)) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end == -1) {
                // We saw the first non-path separator, mark this as the end of our
                // extension
                matchedSlash = false;
                end = i + 1;
            }
            if (code == CHAR_DOT) {
                // If this is our first dot, mark it as the start of our extension
                if (startDot == -1)
                    startDot = i;
                else if (preDotState != 1)
                    preDotState = 1;
            } else if (startDot != -1) {
                // We saw a non-dot and non-path separator before our dot, so we should
                // have a good chance at having a non-empty extension
                preDotState = -1;
            }
        }

        if (startDot == -1 || end == -1 ||
            // We saw a non-dot character immediately before the dot
            preDotState == 0 ||
            // The (right-most) trimmed path component is exactly '..'
            (preDotState == 1 && startDot == end - 1 && startDot == startPart + 1)) {
            return jsEmptyString(vm);
        }
        return substring(vm, path, startDot, end);
    });
}

static void parse(VM& vm, const Input& path, Posix::Parsed& ret)
{
    // Caller handles path.length === 0 and pre-fills every field with ''.
    withChars(path.view, [&](auto p) {
        const Index len = p.size();
        Index rootEnd = 0;
        UChar code = p[0];

        if (len == 1) {
            if (isPathSeparator<W>(code)) {
                // `path` contains just a path separator, exit early to avoid
                // unnecessary work
                ret.root = ret.dir = path.string;
                return;
            }
            ret.base = ret.name = path.string;
            return;
        }
        // Try to match a root
        if (isPathSeparator<W>(code)) {
            // Possible UNC root

            rootEnd = 1;
            if (isPathSeparator<W>(p[1])) {
                // Matched double path separator at beginning
                Index j = 2;
                Index last = j;
                // Match 1 or more non-path separators
                while (j < len && !isPathSeparator<W>(p[j])) {
                    j++;
                }
                if (j < len && j != last) {
                    // Matched!
                    last = j;
                    // Match 1 or more path separators
                    while (j < len && isPathSeparator<W>(p[j])) {
                        j++;
                    }
                    if (j < len && j != last) {
                        // Matched!
                        last = j;
                        // Match 1 or more non-path separators
                        while (j < len && !isPathSeparator<W>(p[j])) {
                            j++;
                        }
                        if (j == len) {
                            // We matched a UNC root only
                            rootEnd = j;
                        } else if (j != last) {
                            // We matched a UNC root with leftovers
                            rootEnd = j + 1;
                        }
                    }
                }
            }
        } else if (isWindowsDeviceRoot(code) && p[1] == CHAR_COLON) {
            // Possible device root
            if (len <= 2) {
                // `path` contains just a drive root, exit early to avoid
                // unnecessary work
                ret.root = ret.dir = path.string;
                return;
            }
            rootEnd = 2;
            if (isPathSeparator<W>(p[2])) {
                if (len == 3) {
                    // `path` contains just a drive root, exit early to avoid
                    // unnecessary work
                    ret.root = ret.dir = path.string;
                    return;
                }
                rootEnd = 3;
            }
        }
        if (rootEnd > 0)
            ret.root = substring(vm, path, 0, rootEnd);

        Index startDot = -1;
        Index startPart = rootEnd;
        Index end = -1;
        bool matchedSlash = true;
        Index i = len - 1;

        // Track the state of characters (if any) we see before our first dot and
        // after any path separator we find
        Index preDotState = 0;

        // Get non-dir info
        for (; i >= rootEnd; --i) {
            code = p[i];
            if (isPathSeparator<W>(code)) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end == -1) {
                // We saw the first non-path separator, mark this as the end of our
                // extension
                matchedSlash = false;
                end = i + 1;
            }
            if (code == CHAR_DOT) {
                // If this is our first dot, mark it as the start of our extension
                if (startDot == -1)
                    startDot = i;
                else if (preDotState != 1)
                    preDotState = 1;
            } else if (startDot != -1) {
                // We saw a non-dot and non-path separator before our dot, so we should
                // have a good chance at having a non-empty extension
                preDotState = -1;
            }
        }

        if (end != -1) {
            if (startDot == -1 ||
                // We saw a non-dot character immediately before the dot
                preDotState == 0 ||
                // The (right-most) trimmed path component is exactly '..'
                (preDotState == 1 && startDot == end - 1 && startDot == startPart + 1)) {
                ret.base = ret.name = substring(vm, path, startPart, end);
            } else {
                ret.name = substring(vm, path, startPart, startDot);
                ret.base = substring(vm, path, startPart, end);
                ret.ext = substring(vm, path, startDot, end);
            }
        }

        // If the directory is the root, use the entire root as the `dir` including
        // the trailing slash if any (`C:\abc` -> `C:\`). Otherwise, strip out the
        // trailing slash (`C:\abc\def` -> `C:\abc`).
        if (startPart > 0 && startPart != rootEnd)
            ret.dir = substring(vm, path, 0, startPart - 1);
        else
            ret.dir = ret.root;
    });
}

} // namespace Win32

// ─────────────────────────────── bindings ────────────────────────────────

#define DEFINE_PATH_FUNCTION(name) \
    template<bool isWindows>       \
    static EncodedJSValue JSC_HOST_CALL_ATTRIBUTES name(JSGlobalObject* globalObject, CallFrame* callFrame)

static ALWAYS_INLINE bool validateString(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value, ASCIILiteral name)
{
    if (value.isString()) [[likely]]
        return true;
    ERR::INVALID_ARG_TYPE(scope, globalObject, name, "string"_s, value);
    return false;
}

DEFINE_PATH_FUNCTION(jsResolve)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const Index argCount = callFrame->argumentCount();

    if constexpr (!isWindows) {
        PathBuffer<UChar> cwdStorage;
        if (argCount <= 1) {
            bool trivial = argCount == 0;
            if (!trivial) {
                JSValue value = callFrame->uncheckedArgument(0);
                if (value.isString()) {
                    Input arg;
                    if (!viewOf(globalObject, scope, value, arg))
                        return {};
                    trivial = arg.length() == 0 || (arg.length() == 1 && arg[0] == CHAR_DOT);
                }
            }
            if (trivial) {
                Input cwd;
                if (!Posix::cwd(globalObject, scope, cwd, cwdStorage))
                    return {};
                if (cwd.length() && cwd[0] == CHAR_FORWARD_SLASH) {
                    if (cwd.string)
                        return JSValue::encode(cwd.string);
                    RELEASE_AND_RETURN(scope, JSValue::encode(withChars(cwd.view, [&](auto s) { return toJS(globalObject, scope, s); })));
                }
            }
        }

        Vector<Input, 16> stack; // in visit (reverse) order
        bool all8Bit = true;
        bool resolvedAbsolute = false;
        for (Index i = argCount - 1; i >= 0 && !resolvedAbsolute; i--) {
            const JSValue value = callFrame->uncheckedArgument(i);
            if (!value.isString()) [[unlikely]]
                return ERR::INVALID_ARG_TYPE(scope, globalObject, makeString("paths["_s, i, ']'), "string"_s, value);
            Input path;
            if (!viewOf(globalObject, scope, value, path))
                return {};

            // Skip empty entries
            if (path.length() == 0) {
                continue;
            }

            stack.append(path);
            all8Bit &= path.is8Bit();
            resolvedAbsolute = path[0] == CHAR_FORWARD_SLASH;
        }

        if (!resolvedAbsolute) {
            Input cwd;
            if (!Posix::cwd(globalObject, scope, cwd, cwdStorage))
                return {};
            stack.append(cwd);
            all8Bit &= cwd.is8Bit();
        }

        Vector<StringView, 16> parts;
        parts.grow(stack.size());
        for (size_t k = 0; k < stack.size(); ++k)
            parts[k] = stack[stack.size() - 1 - k].view;

        auto finish = [&]<typename C>() -> EncodedJSValue {
            PathBuffer<C> out;
            const auto result = Posix::resolve<C>(parts.span(), out);
            if (stack.size() == 1)
                RELEASE_AND_RETURN(scope, JSValue::encode(toJSReusing(globalObject, scope, result, stack[0])));
            RELEASE_AND_RETURN(scope, JSValue::encode(toJS(globalObject, scope, result)));
        };
        if (all8Bit)
            return finish.template operator()<LChar>();
        return finish.template operator()<UChar>();
    } else {
        Win32::ResolveState st;
        PathBuffer<UChar> cwdStorage;
        auto getArg = [&](Index i, Input& out) -> bool {
            const JSValue value = callFrame->uncheckedArgument(i);
            if (!value.isString()) [[unlikely]] {
                ERR::INVALID_ARG_TYPE(scope, globalObject, makeString("paths["_s, i, ']'), "string"_s, value);
                return false;
            }
            return viewOf(globalObject, scope, value, out);
        };
        if (!Win32::resolveScan(globalObject, scope, argCount, getArg, st, cwdStorage))
            return {};
        if (st.returnCwd) {
#if OS(WINDOWS)
            return JSValue::encode(st.cwd.string);
#else
            RELEASE_AND_RETURN(scope, JSValue::encode(withChars(st.cwd.view, [&](auto s) -> JSValue {
                using C = CharOf<decltype(s)>;
                if (indexOf(s, CHAR_FORWARD_SLASH) == -1)
                    return st.cwd.string;
                PathBuffer<C> out;
                return toJS(globalObject, scope, Win32::replaceForwardSlashes(s, out));
            })));
#endif
        }
        if (st.all8Bit) {
            PathBuffer<LChar> out;
            RELEASE_AND_RETURN(scope, JSValue::encode(toJS(globalObject, scope, Win32::resolveBuild<LChar>(st, out))));
        }
        PathBuffer<UChar> out;
        RELEASE_AND_RETURN(scope, JSValue::encode(toJS(globalObject, scope, Win32::resolveBuild<UChar>(st, out))));
    }
}

DEFINE_PATH_FUNCTION(jsNormalize)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const JSValue value = callFrame->argument(0);
    if (!validateString(globalObject, scope, value, "path"_s))
        return {};
    Input path;
    if (!viewOf(globalObject, scope, value, path))
        return {};

    if (path.length() == 0)
        return JSValue::encode(dotString(vm));

    RELEASE_AND_RETURN(scope, JSValue::encode(withChars(path.view, [&](auto p) -> JSValue {
        using C = CharOf<decltype(p)>;
        PathBuffer<C> out;
        const auto result = isWindows ? Win32::normalize<C>(p, out) : Posix::normalize<C>(p, out);
        return toJSReusing(globalObject, scope, result, path);
    })));
}

DEFINE_PATH_FUNCTION(jsJoin)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const unsigned argCount = callFrame->argumentCount();
    if (argCount == 0)
        return JSValue::encode(dotString(vm));

    Vector<StringView, 16> paths;
    Input single;
    bool all8Bit = true;
    for (unsigned i = 0; i < argCount; ++i) {
        const JSValue arg = callFrame->uncheckedArgument(i);
        if (!validateString(globalObject, scope, arg, "path"_s))
            return {};
        Input in;
        if (!viewOf(globalObject, scope, arg, in))
            return {};
        if (in.length() > 0) {
            paths.append(in.view);
            all8Bit &= in.is8Bit();
            single = in;
        }
    }

    if (paths.isEmpty())
        return JSValue::encode(dotString(vm));

    auto finish = [&]<typename C>() -> EncodedJSValue {
        PathBuffer<C> joined, out;
        const auto result = isWindows ? Win32::join<C>(paths.span(), joined, out) : Posix::join<C>(paths.span(), joined, out);
        if (paths.size() == 1)
            RELEASE_AND_RETURN(scope, JSValue::encode(toJSReusing(globalObject, scope, result, single)));
        RELEASE_AND_RETURN(scope, JSValue::encode(toJS(globalObject, scope, result)));
    };
    if (all8Bit)
        return finish.template operator()<LChar>();
    return finish.template operator()<UChar>();
}

DEFINE_PATH_FUNCTION(jsRelative)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const JSValue fromValue = callFrame->argument(0);
    const JSValue toValue = callFrame->argument(1);
    if (!validateString(globalObject, scope, fromValue, "from"_s))
        return {};
    if (!validateString(globalObject, scope, toValue, "to"_s))
        return {};
    Input from, to;
    if (!viewOf(globalObject, scope, fromValue, from))
        return {};
    if (!viewOf(globalObject, scope, toValue, to))
        return {};

    if (from.string == to.string || from.view == to.view)
        return JSValue::encode(jsEmptyString(vm));

    if constexpr (!isWindows) {
        Input cwd;
        PathBuffer<UChar> cwdStorage;
        bool all8Bit = from.is8Bit() && to.is8Bit();
        const Input* cwdIfNeeded = nullptr;
        if (Posix::needsCwd(from.view) || Posix::needsCwd(to.view)) {
            if (!Posix::cwd(globalObject, scope, cwd, cwdStorage))
                return {};
            all8Bit &= cwd.is8Bit();
            cwdIfNeeded = &cwd;
        }
        if (all8Bit)
            RELEASE_AND_RETURN(scope, JSValue::encode(Posix::relative<LChar>(globalObject, scope, from.view, to.view, cwdIfNeeded)));
        RELEASE_AND_RETURN(scope, JSValue::encode(Posix::relative<UChar>(globalObject, scope, from.view, to.view, cwdIfNeeded)));
    } else {
        PathBuffer<LChar> from8, to8;
        PathBuffer<UChar> from16, to16;
        StringView fromOrig, toOrig;
        if (!Win32::resolve(globalObject, scope, std::span<const StringView>(&from.view, 1), from8, from16, fromOrig))
            return {};
        if (!Win32::resolve(globalObject, scope, std::span<const StringView>(&to.view, 1), to8, to16, toOrig))
            return {};
        if (fromOrig.is8Bit() && toOrig.is8Bit())
            RELEASE_AND_RETURN(scope, JSValue::encode(Win32::relative<LChar>(globalObject, scope, fromOrig.span8(), toOrig.span8())));
        auto widen = [](const StringView& v, PathBuffer<UChar>& storage) -> std::span<const UChar> {
            if (!v.is8Bit())
                return v.span16();
            PathBuffer<UChar> wide;
            v.getCharacters(std::span<UChar>(reserve(wide, v.length()), v.length()));
            storage.swap(wide);
            return storage.span();
        };
        const auto f = widen(fromOrig, from16);
        const auto t = widen(toOrig, to16);
        RELEASE_AND_RETURN(scope, JSValue::encode(Win32::relative<UChar>(globalObject, scope, f, t)));
    }
}

DEFINE_PATH_FUNCTION(jsToNamespacedPath)
{
    const JSValue value = callFrame->argument(0);
    if constexpr (!isWindows) {
        // Non-op on posix systems
        return JSValue::encode(value);
    } else {
        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        // Note: this will *probably* throw somewhere.
        if (!value.isString() || asString(value)->length() == 0)
            return JSValue::encode(value);
        Input path;
        if (!viewOf(globalObject, scope, value, path))
            return {};

        PathBuffer<LChar> out8;
        PathBuffer<UChar> out16;
        StringView resolvedPath;
        if (!Win32::resolve(globalObject, scope, std::span<const StringView>(&path.view, 1), out8, out16, resolvedPath))
            return {};

        if (resolvedPath.length() <= 2)
            return JSValue::encode(value);

        RELEASE_AND_RETURN(scope, JSValue::encode(withChars(resolvedPath, [&](auto r) -> JSValue {
            using C = CharOf<decltype(r)>;
            if (r[0] == CHAR_BACKWARD_SLASH) {
                // Possible UNC root
                if (r[1] == CHAR_BACKWARD_SLASH) {
                    const UChar code = r[2];
                    if (code != CHAR_QUESTION_MARK && code != CHAR_DOT) {
                        // Matched non-long UNC root, convert the path to a long UNC path
                        PathBuffer<C> out;
                        C* const begin = reserve(out, 8 + r.size() - 2);
                        C* p = copyChars(begin, "\\\\?\\UNC\\"_span8);
                        p = copyChars(p, r.subspan(2));
                        return toJS(globalObject, scope, spanOf(out, begin, p));
                    }
                }
            } else if (isWindowsDeviceRoot(r[0]) && r[1] == CHAR_COLON && r[2] == CHAR_BACKWARD_SLASH) {
                // Matched device root, convert the path to a long UNC path
                PathBuffer<C> out;
                C* const begin = reserve(out, 4 + r.size());
                C* p = copyChars(begin, "\\\\?\\"_span8);
                p = copyChars(p, r);
                return toJS(globalObject, scope, spanOf(out, begin, p));
            }

            return toJSReusing(globalObject, scope, r, path);
        })));
    }
}

template<bool isWindows>
static ALWAYS_INLINE JSValue dirname(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value)
{
    VM& vm = globalObject->vm();
    if (!validateString(globalObject, scope, value, "path"_s))
        return {};
    Input path;
    if (!viewOf(globalObject, scope, value, path))
        return {};
    if (path.length() == 0)
        return dotString(vm);
    return isWindows ? Win32::dirname(vm, path) : Posix::dirname(vm, path);
}

DEFINE_PATH_FUNCTION(jsDirname)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    return JSValue::encode(dirname<isWindows>(globalObject, scope, callFrame->argument(0)));
}

DEFINE_PATH_FUNCTION(jsBasename)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const JSValue pathValue = callFrame->argument(0);
    const JSValue suffixValue = callFrame->argument(1);
    Input path, suffix;
    const bool hasSuffix = !suffixValue.isUndefined();
    if (hasSuffix && !validateString(globalObject, scope, suffixValue, "suffix"_s))
        return {};
    if (!validateString(globalObject, scope, pathValue, "path"_s))
        return {};
    if (!viewOf(globalObject, scope, pathValue, path))
        return {};
    if (hasSuffix && !viewOf(globalObject, scope, suffixValue, suffix))
        return {};
    return JSValue::encode(isWindows ? Win32::basename(vm, path, hasSuffix ? &suffix : nullptr) : Posix::basename(vm, path, hasSuffix ? &suffix : nullptr));
}

DEFINE_PATH_FUNCTION(jsExtname)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const JSValue value = callFrame->argument(0);
    if (!validateString(globalObject, scope, value, "path"_s))
        return {};
    Input path;
    if (!viewOf(globalObject, scope, value, path))
        return {};
    return JSValue::encode(isWindows ? Win32::extname(vm, path) : Posix::extname(vm, path));
}

DEFINE_PATH_FUNCTION(jsParse)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    const JSValue value = callFrame->argument(0);
    if (!validateString(globalObject, scope, value, "path"_s))
        return {};
    Input path;
    if (!viewOf(globalObject, scope, value, path))
        return {};

    JSString* empty = jsEmptyString(vm);
    Posix::Parsed ret { empty, empty, empty, empty, empty };
    if (path.length() != 0) {
        if constexpr (isWindows)
            Win32::parse(vm, path, ret);
        else
            Posix::parse(vm, path, ret);
    }

    JSObject* result = constructEmptyObject(vm, defaultGlobalObject(globalObject)->pathParsedObjectStructure());
    result->putDirectOffset(vm, 0, ret.root);
    result->putDirectOffset(vm, 1, ret.dir);
    result->putDirectOffset(vm, 2, ret.base);
    result->putDirectOffset(vm, 3, ret.ext);
    result->putDirectOffset(vm, 4, ret.name);
    return JSValue::encode(result);
}

template<bool isWindows>
static JSObject* createBinding(VM& vm, Zig::GlobalObject* globalObject)
{
    auto* binding = constructEmptyObject(globalObject, globalObject->objectPrototype(), 11);
    auto& names = WebCore::builtinNames(vm);
    auto put = [&](const Identifier& name, unsigned length, NativeFunction function) {
        binding->putDirectNativeFunction(vm, globalObject, name, length, function, ImplementationVisibility::Public, NoIntrinsic, 0);
    };
    put(names.resolvePublicName(), 0, jsResolve<isWindows>);
    put(names.normalizePublicName(), 1, jsNormalize<isWindows>);
    binding->putDirect(vm, names.isAbsolutePublicName(), jsUndefined(), 0); // path.ts
    put(names.joinPublicName(), 0, jsJoin<isWindows>);
    put(names.relativePublicName(), 2, jsRelative<isWindows>);
    if constexpr (isWindows)
        put(names.toNamespacedPathPublicName(), 1, jsToNamespacedPath<isWindows>);
    else
        binding->putDirect(vm, names.toNamespacedPathPublicName(), jsUndefined(), 0); // path.ts
    put(names.dirnamePublicName(), 1, jsDirname<isWindows>);
    put(names.basenamePublicName(), 2, jsBasename<isWindows>);
    put(names.extnamePublicName(), 1, jsExtname<isWindows>);
    binding->putDirect(vm, names.formatPublicName(), jsUndefined(), 0); // path.ts
    put(names.parsePublicName(), 1, jsParse<isWindows>);
    return binding;
}

JSValue dirname(JSGlobalObject* globalObject, bool isWindows, JSValue path)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    if (isWindows)
        RELEASE_AND_RETURN(scope, dirname<true>(globalObject, scope, path));
    RELEASE_AND_RETURN(scope, dirname<false>(globalObject, scope, path));
}

WTF::String join(bool isWindows, std::span<const StringView> paths)
{
    Vector<StringView, 8> nonEmpty;
    bool all8Bit = true;
    for (auto& path : paths) {
        if (path.length()) {
            nonEmpty.append(path);
            all8Bit &= path.is8Bit();
        }
    }
    if (nonEmpty.isEmpty())
        return "."_s;
    auto finish = [&]<typename C>() -> WTF::String {
        PathBuffer<C> joined, out;
        return isWindows ? Win32::join<C>(nonEmpty.span(), joined, out) : Posix::join<C>(nonEmpty.span(), joined, out);
    };
    if (all8Bit)
        return finish.template operator()<LChar>();
    return finish.template operator()<UChar>();
}

} // namespace NodePath

JSC::JSValue createNodePathBinding(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* binding = constructEmptyArray(globalObject, nullptr, 2);
    RETURN_IF_EXCEPTION(scope, {});
    binding->putDirectIndex(globalObject, 0, NodePath::createBinding<false>(vm, globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    binding->putDirectIndex(globalObject, 1, NodePath::createBinding<true>(vm, globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    return binding;
}

} // namespace Bun
