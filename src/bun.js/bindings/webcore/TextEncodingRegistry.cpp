/*
 * Copyright (C) 2006-2017 Apple Inc. All rights reserved.
 * Copyright (C) 2007-2009 Torch Mobile, Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "TextEncodingRegistry.h"

#include "TextCodecCJK.h"
#include "TextCodecICU.h"
#include "TextCodecLatin1.h"
#include "TextCodecReplacement.h"
#include "TextCodecSingleByte.h"
#include "TextCodecUTF16.h"
#include "TextCodecUTF8.h"
#include "TextCodecUserDefined.h"
#include "TextEncoding.h"
#include <mutex>
#include <wtf/ASCIICType.h>
#include <wtf/CheckedArithmetic.h>
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>
#include <wtf/MainThread.h>
#include <wtf/StdLibExtras.h>
#include <wtf/text/CString.h>
#include <wtf/text/StringHash.h>

namespace PAL {

constexpr size_t maxEncodingNameLength = 63;

// Hash for all-ASCII strings that does case folding.
struct TextEncodingNameHash {
    static bool equal(std::span<const LChar> s1, std::span<const LChar> s2)
    {
        if (s1.size() != s2.size())
            return false;

        for (size_t i = 0; i < s1.size(); ++i) {
            if (toASCIILower(s1[i]) != toASCIILower(s2[i]))
                return false;
        }

        return true;
    }

    static bool equal(ASCIILiteral s1, ASCIILiteral s2)
    {
        return equal(s1.span8(), s2.span8());
    }

    // This algorithm is the one-at-a-time hash from:
    // http://burtleburtle.net/bob/hash/hashfaq.html
    // http://burtleburtle.net/bob/hash/doobs.html
    static unsigned hash(std::span<const LChar> s)
    {
        unsigned h = WTF::stringHashingStartValue;
        for (char c : s) {
            h += toASCIILower(c);
            h += (h << 10);
            h ^= (h >> 6);
        }
        h += (h << 3);
        h ^= (h >> 11);
        h += (h << 15);
        return h;
    }

    static unsigned hash(ASCIILiteral s)
    {
        return hash(s.span8());
    }

    static const bool safeToCompareToEmptyOrDeleted = false;
};

struct HashTranslatorTextEncodingName {
    static unsigned hash(std::span<const LChar> literal)
    {
        return TextEncodingNameHash::hash(literal);
    }

    static bool equal(const ASCIILiteral& a, std::span<const LChar> b)
    {
        return TextEncodingNameHash::equal(a.span8(), b);
    }
};

using TextEncodingNameMap = HashMap<ASCIILiteral, ASCIILiteral, TextEncodingNameHash>;
using TextCodecMap = HashMap<ASCIILiteral, NewTextCodecFunction>;

static Lock encodingRegistryLock;

static TextEncodingNameMap* textEncodingNameMap WTF_GUARDED_BY_LOCK(encodingRegistryLock);
static TextCodecMap* textCodecMap WTF_GUARDED_BY_LOCK(encodingRegistryLock);
static bool didExtendTextCodecMaps;
static HashSet<ASCIILiteral>* japaneseEncodings;
static HashSet<ASCIILiteral>* nonBackslashEncodings;

static constexpr ASCIILiteral textEncodingNameBlocklist[] = { "UTF-7"_s, "BOCU-1"_s, "SCSU"_s };

static bool isUndesiredAlias(ASCIILiteral alias)
{
    // Reject aliases with version numbers that are supported by some back-ends (such as "ISO_2022,locale=ja,version=0" in ICU).
    if (strchr(alias.characters(), ','))
        return true;
    // 8859_1 is known to (at least) ICU, but other browsers don't support this name - and having it caused a compatibility
    // problem, see bug 43554.
    if (alias == "8859_1"_s)
        return true;
    return false;
}

static void addToTextEncodingNameMap(ASCIILiteral alias, ASCIILiteral name) WTF_REQUIRES_LOCK(encodingRegistryLock)
{
    ASSERT(strlen(alias) <= maxEncodingNameLength);
    if (isUndesiredAlias(alias))
        return;
    ASCIILiteral atomName = textEncodingNameMap->get(name);
    ASSERT((alias == name) || !atomName.isNull());
    if (atomName.isNull())
        atomName = name;

    ASSERT_WITH_MESSAGE(textEncodingNameMap->get(alias).isNull(), "Duplicate text encoding name %s for %s (previously registered as %s)", alias.characters(), atomName.characters(), textEncodingNameMap->get(alias).characters());

    textEncodingNameMap->add(alias, atomName);
}

static void addToTextCodecMap(ASCIILiteral name, NewTextCodecFunction&& function) WTF_REQUIRES_LOCK(encodingRegistryLock)
{
    ASCIILiteral atomName = textEncodingNameMap->get(name);
    ASSERT(!atomName.isNull());
    textCodecMap->add(atomName, WTFMove(function));
}

static void pruneBlocklistedCodecs() WTF_REQUIRES_LOCK(encodingRegistryLock)
{
    for (auto& nameFromBlocklist : textEncodingNameBlocklist) {
        ASCIILiteral atomName = textEncodingNameMap->get(nameFromBlocklist);
        if (atomName.isNull())
            continue;

        Vector<ASCIILiteral> names;
        for (auto& entry : *textEncodingNameMap) {
            if (entry.value == atomName)
                names.append(entry.key);
        }

        for (auto& name : names)
            textEncodingNameMap->remove(name);

        textCodecMap->remove(atomName);
    }
}

static void buildBaseTextCodecMaps() WTF_REQUIRES_LOCK(encodingRegistryLock)
{
    ASSERT(!textCodecMap);
    ASSERT(!textEncodingNameMap);

    textCodecMap = new TextCodecMap;
    textEncodingNameMap = new TextEncodingNameMap;

    TextCodecLatin1::registerEncodingNames(addToTextEncodingNameMap);
    TextCodecLatin1::registerCodecs(addToTextCodecMap);

    TextCodecUTF8::registerEncodingNames(addToTextEncodingNameMap);
    TextCodecUTF8::registerCodecs(addToTextCodecMap);

    TextCodecUTF16::registerEncodingNames(addToTextEncodingNameMap);
    TextCodecUTF16::registerCodecs(addToTextCodecMap);

    TextCodecUserDefined::registerEncodingNames(addToTextEncodingNameMap);
    TextCodecUserDefined::registerCodecs(addToTextCodecMap);
}

static void addEncodingName(HashSet<ASCIILiteral>& set, ASCIILiteral name) WTF_REQUIRES_LOCK(encodingRegistryLock)
{
    // We must not use atomCanonicalTextEncodingName() because this function is called in it.
    ASCIILiteral atomName = textEncodingNameMap->get(name);
    if (!atomName.isNull())
        set.add(atomName);
}

static void buildQuirksSets() WTF_REQUIRES_LOCK(encodingRegistryLock)
{
    // FIXME: Having isJapaneseEncoding() and shouldShowBackslashAsCurrencySymbolIn()
    // and initializing the sets for them in TextEncodingRegistry.cpp look strange.

    ASSERT(!japaneseEncodings);
    ASSERT(!nonBackslashEncodings);

    japaneseEncodings = new HashSet<ASCIILiteral>;
    addEncodingName(*japaneseEncodings, "EUC-JP"_s);
    addEncodingName(*japaneseEncodings, "ISO-2022-JP"_s);
    addEncodingName(*japaneseEncodings, "ISO-2022-JP-1"_s);
    addEncodingName(*japaneseEncodings, "ISO-2022-JP-2"_s);
    addEncodingName(*japaneseEncodings, "ISO-2022-JP-3"_s);
    addEncodingName(*japaneseEncodings, "JIS_C6226-1978"_s);
    addEncodingName(*japaneseEncodings, "JIS_X0201"_s);
    addEncodingName(*japaneseEncodings, "JIS_X0208-1983"_s);
    addEncodingName(*japaneseEncodings, "JIS_X0208-1990"_s);
    addEncodingName(*japaneseEncodings, "JIS_X0212-1990"_s);
    addEncodingName(*japaneseEncodings, "Shift_JIS"_s);
    addEncodingName(*japaneseEncodings, "Shift_JIS_X0213-2000"_s);
    addEncodingName(*japaneseEncodings, "cp932"_s);
    addEncodingName(*japaneseEncodings, "x-mac-japanese"_s);

    nonBackslashEncodings = new HashSet<ASCIILiteral>;
    // The text encodings below treat backslash as a currency symbol for IE compatibility.
    // See http://blogs.msdn.com/michkap/archive/2005/09/17/469941.aspx for more information.
    addEncodingName(*nonBackslashEncodings, "x-mac-japanese"_s);
    addEncodingName(*nonBackslashEncodings, "ISO-2022-JP"_s);
    addEncodingName(*nonBackslashEncodings, "EUC-JP"_s);
    // Shift_JIS_X0213-2000 is not the same encoding as Shift_JIS on Mac. We need to register both of them.
    addEncodingName(*nonBackslashEncodings, "Shift_JIS"_s);
    addEncodingName(*nonBackslashEncodings, "Shift_JIS_X0213-2000"_s);
}

bool isJapaneseEncoding(ASCIILiteral canonicalEncodingName)
{
    return !canonicalEncodingName.isNull() && japaneseEncodings && japaneseEncodings->contains(canonicalEncodingName);
}

bool shouldShowBackslashAsCurrencySymbolIn(ASCIILiteral canonicalEncodingName)
{
    return !canonicalEncodingName.isNull() && nonBackslashEncodings && nonBackslashEncodings->contains(canonicalEncodingName);
}

static void extendTextCodecMaps() WTF_REQUIRES_LOCK(encodingRegistryLock)
{
    TextCodecReplacement::registerEncodingNames(addToTextEncodingNameMap);
    TextCodecReplacement::registerCodecs(addToTextCodecMap);

    TextCodecICU::registerEncodingNames(addToTextEncodingNameMap);
    TextCodecICU::registerCodecs(addToTextCodecMap);

    TextCodecCJK::registerEncodingNames(addToTextEncodingNameMap);
    TextCodecCJK::registerCodecs(addToTextCodecMap);

    TextCodecSingleByte::registerEncodingNames(addToTextEncodingNameMap);
    TextCodecSingleByte::registerCodecs(addToTextCodecMap);

    pruneBlocklistedCodecs();
    buildQuirksSets();
}

std::unique_ptr<TextCodec> newTextCodec(const TextEncoding& encoding)
{
    Locker locker { encodingRegistryLock };

    ASSERT(textCodecMap);
    if (!encoding.isValid()) {
        return nullptr;
    }
    auto result = textCodecMap->find(encoding.name());
    if (result == textCodecMap->end()) {
        return nullptr;
    }
    if (!result->value) {
        // RELEASE_LOG_ERROR(TextEncoding, "Codec for encoding %" PUBLIC_LOG_STRING " is null. Will default to UTF-8", encoding.name().characters());
        return nullptr;
    }

    return result->value();
}

static ASCIILiteral atomCanonicalTextEncodingName(std::span<const LChar> name)
{
    if (name.empty())
        return {};

    Locker locker { encodingRegistryLock };

    if (!textEncodingNameMap)
        buildBaseTextCodecMaps();

    if (ASCIILiteral atomName = textEncodingNameMap->get<HashTranslatorTextEncodingName>(name))
        return atomName;
    if (didExtendTextCodecMaps)
        return {};

    extendTextCodecMaps();
    didExtendTextCodecMaps = true;
    return textEncodingNameMap->get<HashTranslatorTextEncodingName>(name);
}

static ASCIILiteral atomCanonicalTextEncodingName(std::span<const UChar> characters)
{
    if (characters.size() > maxEncodingNameLength)
        return {};

    std::array<LChar, maxEncodingNameLength> buffer;
    for (size_t i = 0; i < characters.size(); ++i)
        buffer[i] = characters[i];

    return atomCanonicalTextEncodingName(std::span { buffer }.first(characters.size()));
}

ASCIILiteral atomCanonicalTextEncodingName(ASCIILiteral name)
{
    return atomCanonicalTextEncodingName(name.span8());
}

ASCIILiteral atomCanonicalTextEncodingName(StringView alias)
{
    if (alias.isEmpty() || !alias.containsOnlyASCII())
        return {};

    if (alias.is8Bit())
        return atomCanonicalTextEncodingName(alias.span8());

    return atomCanonicalTextEncodingName(alias.span16());
}

bool noExtendedTextEncodingNameUsed()
{
    // If the calling thread did not use extended encoding names, it is fine for it to use a stale false value.
    return !didExtendTextCodecMaps;
}

String defaultTextEncodingNameForSystemLanguage()
{
#if PLATFORM(COCOA)
    String systemEncodingName = CFStringConvertEncodingToIANACharSetName(webDefaultCFStringEncoding());

    // CFStringConvertEncodingToIANACharSetName() returns cp949 for kTextEncodingDOSKorean AKA "extended EUC-KR" AKA windows-949.
    // ICU uses this name for a different encoding, so we need to change the name to a value that actually gives us windows-949.
    // In addition, this value must match what is used in Safari, see <rdar://problem/5579292>.
    // On some OS versions, the result is CP949 (uppercase).
    if (equalLettersIgnoringASCIICase(systemEncodingName, "cp949"_s))
        systemEncodingName = "ks_c_5601-1987"_s;

    // CFStringConvertEncodingToIANACharSetName() returns cp874 for kTextEncodingDOSThai, AKA windows-874.
    // Since "cp874" alias is not standard (https://encoding.spec.whatwg.org/#names-and-labels), map to
    // "dos-874" instead.
    if (equalLettersIgnoringASCIICase(systemEncodingName, "cp874"_s))
        systemEncodingName = "dos-874"_s;

    return systemEncodingName;
#else
    return "ISO-8859-1"_s;
#endif
}

} // namespace PAL
