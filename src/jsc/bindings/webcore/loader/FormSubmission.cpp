/*
 * Copyright (C) 2010 Google Inc. All rights reserved.
 * Copyright (C) 2015-2016 Apple Inc. All rights reserved.
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

#include "config.h"
#include "FormSubmission.h"

#include "CommonAtomStrings.h"

namespace WebCore {

ASCIILiteral FormSubmission::Attributes::methodString(Method method)
{
    if (method == Method::Dialog)
        return "dialog"_s;
    if (method == Method::Post)
        return "post"_s;
    return "get"_s;
}

String FormSubmission::Attributes::parseEncodingType(const String& type)
{
    if (equalLettersIgnoringASCIICase(type, "multipart/form-data"_s))
        return "multipart/form-data"_s;
    if (equalLettersIgnoringASCIICase(type, "text/plain"_s))
        return textPlainContentTypeAtom();
    return "application/x-www-form-urlencoded"_s;
}

void FormSubmission::Attributes::updateEncodingType(const String& type)
{
    m_encodingType = parseEncodingType(type);
}

FormSubmission::Method FormSubmission::Attributes::parseMethodType(const String& type)
{
    if (equalLettersIgnoringASCIICase(type, "dialog"_s))
        return FormSubmission::Method::Dialog;

    if (equalLettersIgnoringASCIICase(type, "post"_s))
        return FormSubmission::Method::Post;

    return FormSubmission::Method::Get;
}

void FormSubmission::Attributes::updateMethodType(const String& type)
{
    m_method = parseMethodType(type);
}

}
