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

#pragma once

#include <wtf/text/WTFString.h>

namespace WebCore {

String resetButtonDefaultLabel();
String submitButtonDefaultLabel();

String validationMessageValueMissingText();
String validationMessageValueMissingForCheckboxText();
String validationMessageValueMissingForFileText();
String validationMessageValueMissingForMultipleFileText();
String validationMessageValueMissingForRadioText();
String validationMessageValueMissingForSelectText();
String validationMessageTypeMismatchText();
String validationMessageTypeMismatchForEmailText();
String validationMessageTypeMismatchForMultipleEmailText();
String validationMessageTypeMismatchForURLText();
String validationMessagePatternMismatchText();
String validationMessagePatternMismatchText(const String& title);
String validationMessageTooShortText(int valueLength, int minLength);
String validationMessageTooLongText(int valueLength, int maxLength);
String validationMessageRangeUnderflowText(const String& minimum);
String validationMessageRangeOverflowText(const String& maximum);
String validationMessageStepMismatchText(const String& base, const String& step);

} // namespace WebCore
