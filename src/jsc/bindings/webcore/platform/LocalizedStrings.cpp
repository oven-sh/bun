/*
 * Copyright (C) 2003-2021 Apple Inc. All rights reserved.
 * Copyright (C) 2010 Igalia S.L
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
#include "LocalizedStrings.h"

#include <wtf/text/MakeString.h>

namespace WebCore {

String resetButtonDefaultLabel()
{
    return "Reset"_s;
}

String submitButtonDefaultLabel()
{
    return "Submit"_s;
}

String validationMessageValueMissingText()
{
    return "Fill out this field"_s;
}

String validationMessageValueMissingForCheckboxText()
{
    return "Select this checkbox"_s;
}

String validationMessageValueMissingForFileText()
{
    return "Select a file"_s;
}

String validationMessageValueMissingForMultipleFileText()
{
    return validationMessageValueMissingForFileText();
}

String validationMessageValueMissingForRadioText()
{
    return "Select one of these options"_s;
}

String validationMessageValueMissingForSelectText()
{
    return "Select an item in the list"_s;
}

String validationMessageTypeMismatchText()
{
    return "Invalid value"_s;
}

String validationMessageTypeMismatchForEmailText()
{
    return "Enter an email address"_s;
}

String validationMessageTypeMismatchForMultipleEmailText()
{
    return validationMessageTypeMismatchForEmailText();
}

String validationMessageTypeMismatchForURLText()
{
    return "Enter a URL"_s;
}

String validationMessagePatternMismatchText()
{
    return "Match the requested format"_s;
}

String validationMessagePatternMismatchText(const String& title)
{
    return makeString("Match the requested format: "_s, title);
}

String validationMessageTooShortText(int, int minLength)
{
    return makeString("Use at least "_s, minLength, " characters"_s);
}

String validationMessageTooLongText(int, int maxLength)
{
    return makeString("Use no more than "_s, maxLength, " characters"_s);
}

String validationMessageRangeUnderflowText(const String& minimum)
{
    return makeString("Value must be greater than or equal to "_s, minimum);
}

String validationMessageRangeOverflowText(const String& maximum)
{
    return makeString("Value must be less than or equal to "_s, maximum);
}

String validationMessageStepMismatchText(const String&, const String&)
{
    return "Enter a valid value"_s;
}

} // namespace WebCore
