/*
 * Copyright (C) 2007, 2008 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once
#include "root.h"

#include "ExceptionCode.h"
#include <wtf/text/WTFString.h>

namespace WebCore {

class Exception;

class DOMException : public RefCounted<DOMException> {
public:
    static Ref<DOMException> create(ExceptionCode, const String& message = emptyString());
    static Ref<DOMException> create(const Exception&);

    // For DOM bindings.
    static Ref<DOMException> create(const String& message, const String& name);

    using LegacyCode = uint8_t;
    LegacyCode legacyCode() const { return m_legacyCode; }

    String name() const { return m_name; }
    String message() const { return m_message; }

    struct Description {
        const ASCIILiteral name;
        const ASCIILiteral message;
        LegacyCode legacyCode;
    };

    WEBCORE_EXPORT static const Description& description(ExceptionCode);

    static ASCIILiteral name(ExceptionCode ec) { return description(ec).name; }
    static ASCIILiteral message(ExceptionCode ec) { return description(ec).message; }

protected:
    DOMException(LegacyCode, const String& name, const String& message);

private:
    LegacyCode m_legacyCode;
    String m_name;
    String m_message;
};

} // namespace WebCore
