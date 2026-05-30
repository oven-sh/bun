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

#include <wtf/NeverDestroyed.h>
#include <wtf/text/AtomString.h>

namespace WebCore {

// clang-format off
#define WEBCORE_COMMON_ATOM_STRINGS_FOR_EACH_KEYWORD(macro) \
    macro(alternative, "alternative") \
    macro(auto, "auto") \
    macro(captions, "captions") \
    macro(commentary, "commentary") \
    macro(cssContentType, "text/css") \
    macro(eager, "eager") \
    macro(email, "email") \
    macro(false, "false") \
    macro(lazy, "lazy") \
    macro(main, "main") \
    macro(none, "none") \
    macro(off, "off") \
    macro(on, "on") \
    macro(plaintextOnly, "plaintext-only") \
    macro(reset, "reset") \
    macro(search, "search") \
    macro(star, "*") \
    macro(submit, "submit") \
    macro(subtitles, "subtitles") \
    macro(tel, "tel") \
    macro(text, "text") \
    macro(textPlainContentType, "text/plain") \
    macro(true, "true") \
    macro(url, "url") \
    macro(xml, "xml") \
    macro(xmlns, "xmlns")


#define DECLARE_COMMON_ATOM(atomName, atomValue) \
    extern MainThreadLazyNeverDestroyed<const AtomString> atomName ## AtomData; \
    inline const AtomString& atomName ## Atom() { return atomName ## AtomData.get(); }

WEBCORE_COMMON_ATOM_STRINGS_FOR_EACH_KEYWORD(DECLARE_COMMON_ATOM)

#undef DECLARE_COMMON_ATOM
// clang-format on

WEBCORE_EXPORT void initializeCommonAtomStrings();

} // namespace WebCore
