/*
 * Copyright (C) 2022 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include <wtf/text/AtomString.h>

namespace WebCore {

#define WEBCORE_COMMON_ATOM_STRINGS_FOR_EACH_KEYWORD(macro) \
    macro(all, "all") \
    macro(any, "any") \
    macro(applicationXHTMLContentType, "application/xhtml+xml") \
    macro(applicationXMLContentType, "application/xml") \
    macro(applicationOctetStream, "application/octet-stream") \
    macro(attributes, "attributes") \
    macro(auto, "auto") \
    macro(captions, "captions")                             \
    macro(characterData, "characterData") \
    macro(childList, "childList") \
    macro(closed, "closed") \
    macro(closerequest, "closerequest") \
    macro(commentary, "commentary") \
    macro(cssContentType, "text/css") \
    macro(email, "email") \
    macro(false, "false") \
    macro(hint, "hint") \
    macro(imageSVGContentType, "image/svg+xml") \
    macro(ltr, "ltr") \
    macro(manual, "manual") \
    macro(named, "named") \
    macro(none, "none") \
    macro(off, "off") \
    macro(on, "on") \
    macro(open, "open") \
    macro(pickerSelect, "picker(select)") \
    macro(plaintextOnly, "plaintext-only") \
    macro(print, "print") \
    macro(reset, "reset") \
    macro(rtl, "rtl") \
    macro(screen, "screen") \
    macro(search, "search") \
    macro(star, "*") \
    macro(submit, "submit") \
    macro(subtitles, "subtitles") \
    macro(tel, "tel") \
    macro(text, "text") \
    macro(textHTMLContentType, "text/html") \
    macro(textPlainContentType, "text/plain") \
    macro(textXMLContentType, "text/xml") \
    macro(true, "true") \
    macro(url, "url") \
    macro(xml, "xml") \
    macro(xmlns, "xmlns")


#define DECLARE_COMMON_ATOM_ENUMERATOR(atomName, atomValue) atomName ## Atom,
enum class CommonAtomString : uint8_t {
    WEBCORE_COMMON_ATOM_STRINGS_FOR_EACH_KEYWORD(DECLARE_COMMON_ATOM_ENUMERATOR)
};
#undef DECLARE_COMMON_ATOM_ENUMERATOR

#define COUNT_COMMON_ATOM(atomName, atomValue) + 1
inline constexpr unsigned commonAtomStringCount = 0 WEBCORE_COMMON_ATOM_STRINGS_FOR_EACH_KEYWORD(COUNT_COMMON_ATOM);
#undef COUNT_COMMON_ATOM

// The AtomStrings are per VM (StaticNames).
WEBCORE_EXPORT const AtomString& commonAtomString(CommonAtomString);

#define DECLARE_COMMON_ATOM(atomName, atomValue) \
    inline const AtomString& atomName ## Atom() { return commonAtomString(CommonAtomString::atomName ## Atom); }

WEBCORE_COMMON_ATOM_STRINGS_FOR_EACH_KEYWORD(DECLARE_COMMON_ATOM)

#undef DECLARE_COMMON_ATOM

} // namespace WebCore
