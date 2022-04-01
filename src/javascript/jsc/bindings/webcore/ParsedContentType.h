/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 * Copyright (C) 2012 Intel Corporation. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Google Inc. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include <wtf/HashMap.h>
#include <wtf/text/StringHash.h>

namespace WebCore {

enum class Mode {
    Rfc2045,
    MimeSniff
};
WEBCORE_EXPORT bool isValidContentType(const String&, Mode = Mode::MimeSniff);

// FIXME: add support for comments.
class ParsedContentType {
public:
    WEBCORE_EXPORT static std::optional<ParsedContentType> create(const String&, Mode = Mode::MimeSniff);
    ParsedContentType(ParsedContentType&&) = default;

    String mimeType() const { return m_mimeType; }
    String charset() const;
    void setCharset(String&&);

    // Note that in the case of multiple values for the same name, the last value is returned.
    String parameterValueForName(const String&) const;
    size_t parameterCount() const;

    WEBCORE_EXPORT String serialize() const;

private:
    ParsedContentType(const String&);
    ParsedContentType(const ParsedContentType&) = delete;
    ParsedContentType& operator=(ParsedContentType const&) = delete;
    bool parseContentType(Mode);
    void setContentType(StringView, Mode);
    void setContentTypeParameter(const String&, const String&, Mode);

    typedef HashMap<String, String> KeyValuePairs;
    String m_contentType;
    KeyValuePairs m_parameterValues;
    Vector<String> m_parameterNames;
    String m_mimeType;
};

}
