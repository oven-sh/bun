#include "root.h"
#include "truncateAnsi.h"
#include "ANSIHelpers.h"

#include <wtf/text/WTFString.h>
#include <wtf/text/StringBuilder.h>
#include <JavaScriptCore/JSObject.h>

namespace Bun {
using namespace WTF;

// ============================================================================
// Options
// ============================================================================

enum class TruncatePosition { End, Start, Middle };

struct TruncateOptions {
    TruncatePosition position = TruncatePosition::End;
    bool space = false;
    bool preferTruncationOnSpace = false;
    WTF::String truncationCharacter;
};

// ============================================================================
// Visible width of a WTF::String
// ============================================================================

static size_t wtfStringWidth(const WTF::String& str)
{
    if (str.isNull() || str.isEmpty())
        return 0;
    if (str.is8Bit())
        return ANSI::stringWidth(str.span8().data(), str.length());
    return ANSI::stringWidth(str.span16().data(), str.length());
}

// ============================================================================
// ANSI-aware slicing by visible column range [beginCol, endCol).
// All ANSI escape sequences are always passed through.
// ============================================================================

// Map an SGR open code to its close code.
static uint32_t sgrCloseCode(uint32_t code)
{
    if (code == 0) return 0; // reset
    if (code == 1 || code == 2) return 22;
    if (code == 3) return 23;
    if (code == 4) return 24;
    if (code == 7) return 27;
    if (code == 8) return 28;
    if (code == 9) return 29;
    if ((code >= 30 && code <= 38) || (code >= 90 && code <= 97)) return 39;
    if ((code >= 40 && code <= 48) || (code >= 100 && code <= 107)) return 49;
    return 0;
}

// Parse a simple SGR code: \e[<digits>m → returns the number, or -1.
template<typename Char>
static int32_t parseSingleSgr(const Char* start, const Char* seqEnd)
{
    // Must be ESC [ <digits> m
    size_t len = seqEnd - start;
    if (len < 4) return -1;
    if (start[0] != 0x1b || start[1] != '[') return -1;
    if (start[len - 1] != 'm') return -1;
    int32_t val = 0;
    for (size_t i = 2; i < len - 1; i++) {
        Char c = start[i];
        if (c >= '0' && c <= '9') val = val * 10 + (c - '0');
        else return -1; // semicolons / compound - skip tracking
    }
    return val;
}

// Tracks active SGR styles as a map: closeCode → full escape sequence string.
using SgrMap = HashMap<uint32_t, WTF::String>;

// Process a block of possibly-chained ANSI sequences, updating SGR state for each.
template<typename Char>
static void updateSgrState(SgrMap& active, const Char* start, const Char* blockEnd)
{
    // consumeANSI may chain multiple sequences. Parse each ESC[...m individually.
    const Char* p = start;
    while (p < blockEnd) {
        // Find next ESC [ ... m sequence
        if (*p == 0x1b && p + 1 < blockEnd && p[1] == '[') {
            const Char* seqStart = p;
            p += 2; // skip ESC [
            while (p < blockEnd && ((*p >= '0' && *p <= '9') || *p == ';'))
                p++;
            if (p < blockEnd && *p == 'm') {
                p++; // skip 'm'
                // Parse this individual SGR: seqStart to p
                int32_t code = parseSingleSgr(seqStart, p);
                if (code >= 0) {
                    if (code == 0) {
                        active.clear();
                    } else {
                        uint32_t closeCode = sgrCloseCode(static_cast<uint32_t>(code));
                        if (closeCode != 0) {
                            if (static_cast<uint32_t>(code) == closeCode) {
                                active.remove(closeCode);
                            } else {
                                size_t len = p - seqStart;
                                if constexpr (sizeof(Char) == 1)
                                    active.set(closeCode, WTF::String(std::span<const Latin1Character>(reinterpret_cast<const Latin1Character*>(seqStart), len)));
                                else
                                    active.set(closeCode, WTF::String(std::span<const UChar>(reinterpret_cast<const UChar*>(seqStart), len)));
                            }
                        }
                    }
                }
                continue;
            }
        }
        p++;
    }
}

static void emitSgrCloses(SgrMap& active, StringBuilder& out)
{
    // Emit close codes in reverse order for proper nesting
    Vector<uint32_t> keys;
    for (auto& kv : active) keys.append(kv.key);
    for (size_t i = keys.size(); i > 0; i--) {
        UChar buf[8];
        buf[0] = 0x1b; buf[1] = '[';
        size_t pos = 2;
        uint32_t code = keys[i - 1];
        if (code >= 100) { buf[pos++] = '0' + (code / 100); code %= 100; buf[pos++] = '0' + (code / 10); code %= 10; }
        else if (code >= 10) { buf[pos++] = '0' + (code / 10); code %= 10; }
        buf[pos++] = '0' + code;
        buf[pos++] = 'm';
        out.append(std::span<const UChar>(buf, pos));
    }
}

static void emitSgrOpens(SgrMap& active, StringBuilder& out)
{
    for (auto& kv : active) out.append(kv.value);
}

template<typename Char>
static void sliceAnsi(const Char* input, size_t inputLen,
    size_t beginCol, size_t endCol, StringBuilder& out)
{
    if (beginCol >= endCol)
        return;

    const Char* it = input;
    const Char* end = input + inputLen;
    size_t col = 0;
    bool include = false;
    SgrMap activeStyles;

    while (it < end) {
        // ANSI escape sequences
        if (ANSI::isEscapeCharacter(*it)) {
            const Char* seqEnd = ANSI::consumeANSI(it, end);
            // Track SGR state regardless
            updateSgrState(activeStyles, it, seqEnd);
            // Only emit if we're currently including
            if (include)
                out.append(std::span { it, seqEnd });
            it = seqEnd;
            continue;
        }

        size_t charLen;
        char32_t cp = ANSI::decodeChar(it, end, charLen);
        uint8_t w = ANSI::codepointWidth(cp, false);

        // Zero-width: include if currently including
        if (w == 0) {
            if (include)
                out.append(std::span { it, it + charLen });
            it += charLen;
            continue;
        }

        // Past end: stop
        if (col >= endCol)
            break;

        // Entering range: emit active styles then start including
        if (!include && col + w > beginCol) {
            include = true;
            emitSgrOpens(activeStyles, out);
        }

        if (include && col + w <= endCol)
            out.append(std::span { it, it + charLen });

        col += w;
        it += charLen;

        // Past end: stop processing visible characters
        if (col >= endCol)
            break;
    }

    // Emit close codes for any still-active styles
    if (include)
        emitSgrCloses(activeStyles, out);
}

// ============================================================================
// SGR style-inheritance helpers
// ============================================================================

static inline bool isSgrParam(UChar c) { return (c >= '0' && c <= '9') || c == ';'; }

// Index of first byte after leading SGR spans (\e[...m sequences).
static size_t leadingSgrEnd(const StringView& sv)
{
    size_t i = 0, len = sv.length();
    while (i + 2 < len && sv[i] == 0x1b && sv[i + 1] == '[') {
        size_t j = i + 2;
        while (j < len && isSgrParam(sv[j])) j++;
        if (j < len && sv[j] == 'm') { i = j + 1; continue; }
        break;
    }
    return i;
}

// Index of first byte of trailing SGR spans.
static size_t trailingSgrStart(const StringView& sv)
{
    size_t start = sv.length();
    while (start > 1 && sv[start - 1] == 'm') {
        size_t j = start - 2;
        while (j > 0 && isSgrParam(sv[j])) j--;
        if (j >= 1 && sv[j - 1] == 0x1b && sv[j] == '[') { start = j - 1; continue; }
        break;
    }
    return start;
}

static void appendSub(StringBuilder& out, const WTF::String& s, size_t a, size_t b)
{
    if (a >= b) return;
    if (s.is8Bit()) { auto sp = s.span8(); out.append(std::span { sp.data() + a, sp.data() + b }); }
    else { auto sp = s.span16(); out.append(std::span { sp.data() + a, sp.data() + b }); }
}

// Insert suffix before trailing SGR (style inheritance for 'end').
static WTF::String appendWithInheritedStyle(const WTF::String& vis, const WTF::String& suffix)
{
    StringView sv = vis.isNull() ? StringView() : StringView(vis);
    size_t sgr = trailingSgrStart(sv);
    StringBuilder r;
    r.reserveCapacity(vis.length() + suffix.length());
    if (sgr < sv.length()) { appendSub(r, vis, 0, sgr); r.append(suffix); appendSub(r, vis, sgr, sv.length()); }
    else { r.append(vis); r.append(suffix); }
    return r.toString();
}

// Insert prefix after leading SGR (style inheritance for 'start').
static WTF::String prependWithInheritedStyle(const WTF::String& prefix, const WTF::String& vis)
{
    StringView sv = vis.isNull() ? StringView() : StringView(vis);
    size_t sgr = leadingSgrEnd(sv);
    StringBuilder r;
    r.reserveCapacity(vis.length() + prefix.length());
    if (sgr > 0) { appendSub(r, vis, 0, sgr); r.append(prefix); appendSub(r, vis, sgr, sv.length()); }
    else { r.append(prefix); r.append(vis); }
    return r.toString();
}

// ============================================================================
// preferTruncationOnSpace: find nearest space within 3 visible cols
// ============================================================================

template<typename Char>
static UChar visibleCharAt(const Char* input, size_t inputLen, size_t visIdx)
{
    const Char* it = input;
    const Char* end = input + inputLen;
    size_t col = 0;
    while (it < end) {
        if (ANSI::isEscapeCharacter(*it)) { it = ANSI::consumeANSI(it, end); continue; }
        size_t cLen;
        char32_t cp = ANSI::decodeChar(it, end, cLen);
        uint8_t w = ANSI::codepointWidth(cp, false);
        if (w == 0) { it += cLen; continue; }
        if (col == visIdx) return static_cast<UChar>(*it);
        col += w;
        it += cLen;
    }
    return 0;
}

template<typename Char>
static size_t nearestSpace(const Char* input, size_t inputLen, size_t idx, bool searchRight)
{
    if (visibleCharAt(input, inputLen, idx) == ' ') return idx;
    int dir = searchRight ? 1 : -1;
    for (int i = 0; i <= 3; i++) {
        int fi = static_cast<int>(idx) + i * dir;
        if (fi < 0) continue;
        if (visibleCharAt(input, inputLen, static_cast<size_t>(fi)) == ' ')
            return static_cast<size_t>(fi);
    }
    return idx;
}

// ============================================================================
// Build effective truncation string (applying `space` option)
// ============================================================================

static WTF::String buildTruncChar(const TruncateOptions& opts)
{
    static constexpr UChar ellipsis = 0x2026;
    WTF::String base = opts.truncationCharacter.isNull()
        ? WTF::String(std::span<const UChar>(&ellipsis, 1))
        : opts.truncationCharacter;

    if (!opts.space) return base;

    StringBuilder sb;
    switch (opts.position) {
    case TruncatePosition::End:    sb.append(' '); sb.append(base); break;
    case TruncatePosition::Start:  sb.append(base); sb.append(' '); break;
    case TruncatePosition::Middle: sb.append(' '); sb.append(base); sb.append(' '); break;
    }
    return sb.toString();
}

// ============================================================================
// Truncation by position
// ============================================================================

template<typename Char>
static WTF::String truncEnd(const Char* in, size_t inLen, size_t totalW,
    size_t cols, const TruncateOptions& opts, const WTF::String& tc, size_t tcW)
{
    if (opts.preferTruncationOnSpace) {
        size_t sp = nearestSpace(in, inLen, cols - 1, false);
        StringBuilder buf; sliceAnsi(in, inLen, 0, sp, buf);
        return appendWithInheritedStyle(buf.toString(), tc);
    }
    StringBuilder buf; sliceAnsi(in, inLen, 0, cols - tcW, buf);
    return appendWithInheritedStyle(buf.toString(), tc);
}

template<typename Char>
static WTF::String truncStart(const Char* in, size_t inLen, size_t totalW,
    size_t cols, const TruncateOptions& opts, const WTF::String& tc, size_t tcW)
{
    if (opts.preferTruncationOnSpace) {
        size_t sp = nearestSpace(in, inLen, totalW - cols + 1, true);
        StringBuilder buf; sliceAnsi(in, inLen, sp, totalW, buf);
        // Trim leading visible whitespace
        auto s = buf.toString();
        auto sv = StringView(s);
        size_t trim = 0;
        for (size_t i = 0; i < sv.length(); i++) {
            UChar c = sv[i];
            if (c == 0x1b) { /* skip ANSI in trim scan */ break; }
            if (c == ' ' || c == '\t') { trim++; continue; }
            break;
        }
        if (trim > 0) {
            StringBuilder trimmed;
            appendSub(trimmed, s, trim, sv.length());
            return prependWithInheritedStyle(tc, trimmed.toString());
        }
        return prependWithInheritedStyle(tc, s);
    }
    StringBuilder buf; sliceAnsi(in, inLen, totalW - cols + tcW, totalW, buf);
    return prependWithInheritedStyle(tc, buf.toString());
}

template<typename Char>
static WTF::String truncMiddle(const Char* in, size_t inLen, size_t totalW,
    size_t cols, const TruncateOptions& opts, const WTF::String& tc, size_t tcW)
{
    size_t half = cols / 2;

    if (opts.preferTruncationOnSpace) {
        size_t sp1 = nearestSpace(in, inLen, half, false);
        size_t sp2 = nearestSpace(in, inLen, totalW - (cols - half) + 1, true);
        StringBuilder left; sliceAnsi(in, inLen, 0, sp1, left);
        StringBuilder right; sliceAnsi(in, inLen, sp2, totalW, right);
        // Trim leading whitespace from right
        auto rs = right.toString(); auto rv = StringView(rs);
        size_t trim = 0;
        while (trim < rv.length() && (rv[trim] == ' ' || rv[trim] == '\t')) trim++;
        StringBuilder r; r.append(left); r.append(tc);
        if (trim > 0) appendSub(r, rs, trim, rv.length());
        else r.append(rs);
        return r.toString();
    }

    StringBuilder left;  sliceAnsi(in, inLen, 0, half, left);
    StringBuilder right; sliceAnsi(in, inLen, totalW - (cols - half) + tcW, totalW, right);
    StringBuilder r; r.append(left); r.append(tc); r.append(right);
    return r.toString();
}

// ============================================================================
// Entry point
// ============================================================================

template<typename Char>
static WTF::String truncateAnsiImpl(const Char* input, size_t inputLen,
    size_t columns, const TruncateOptions& opts)
{
    size_t totalWidth = ANSI::stringWidth(input, inputLen);
    if (totalWidth <= columns) return WTF::String(); // null = no truncation

    WTF::String tc = buildTruncChar(opts);
    size_t tcW = wtfStringWidth(tc);

    if (columns == 1) return tc;

    switch (opts.position) {
    case TruncatePosition::End:    return truncEnd(input, inputLen, totalWidth, columns, opts, tc, tcW);
    case TruncatePosition::Start:  return truncStart(input, inputLen, totalWidth, columns, opts, tc, tcW);
    case TruncatePosition::Middle: return truncMiddle(input, inputLen, totalWidth, columns, opts, tc, tcW);
    }
    RELEASE_ASSERT_NOT_REACHED();
}

// ============================================================================
// JSC Host Function
// ============================================================================

static TruncatePosition parsePosition(JSC::JSGlobalObject* globalObject, JSC::VM& vm, JSC::JSValue val)
{
    if (!val.isString()) return TruncatePosition::End;
    auto scope = DECLARE_THROW_SCOPE(vm);
    const auto view = val.toString(globalObject)->view(globalObject);
    RETURN_IF_EXCEPTION(scope, TruncatePosition::End);
    if (view->length() == 0) return TruncatePosition::End;
    UChar c = view->is8Bit() ? view->span8()[0] : view->span16()[0];
    if (c == 's' || c == 'S') return TruncatePosition::Start;
    if (c == 'm' || c == 'M') return TruncatePosition::Middle;
    return TruncatePosition::End;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionBunTruncateAnsi, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    // arg 0: text
    JSC::JSString* jsString = callFrame->argument(0).toString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});

    // arg 1: columns
    JSC::JSValue colVal = callFrame->argument(1);
    if (!colVal.isNumber()) {
        throwTypeError(globalObject, scope, "Expected columns to be a number"_s);
        return {};
    }
    int32_t columns = colVal.toInt32(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (columns < 1)
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));

    // arg 2: position string or options object
    TruncateOptions opts;
    JSC::JSValue arg2 = callFrame->argument(2);

    if (arg2.isString()) {
        opts.position = parsePosition(globalObject, vm, arg2);
        RETURN_IF_EXCEPTION(scope, {});
    } else if (arg2.isObject()) {
        JSC::JSObject* obj = arg2.getObject();

        opts.position = parsePosition(globalObject, vm,
            obj->get(globalObject, JSC::Identifier::fromString(vm, "position"_s)));
        RETURN_IF_EXCEPTION(scope, {});

        JSC::JSValue v = obj->get(globalObject, JSC::Identifier::fromString(vm, "space"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (v.isBoolean()) opts.space = v.asBoolean();

        v = obj->get(globalObject, JSC::Identifier::fromString(vm, "preferTruncationOnSpace"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (v.isBoolean()) opts.preferTruncationOnSpace = v.asBoolean();

        v = obj->get(globalObject, JSC::Identifier::fromString(vm, "truncationCharacter"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (v.isString()) {
            const auto tcView = v.toString(globalObject)->view(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            opts.truncationCharacter = tcView->toString();
        }
    }

    const auto view = jsString->view(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (view->isEmpty())
        return JSC::JSValue::encode(JSC::jsEmptyString(vm));

    WTF::String result;
    if (view->is8Bit())
        result = truncateAnsiImpl(view->span8().data(), view->length(), static_cast<size_t>(columns), opts);
    else
        result = truncateAnsiImpl(view->span16().data(), view->length(), static_cast<size_t>(columns), opts);

    if (result.isNull())
        return JSC::JSValue::encode(jsString);
    return JSC::JSValue::encode(JSC::jsString(vm, result));
}

} // namespace Bun
