/*
 * Copyright (C) 2016-2020 Apple Inc. All rights reserved.
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
#include <wtf/text/WTFString.h>

namespace WebCore {

enum class AutofillMantle {
    Expectation,
    Anchor
};

enum class NonAutofillCredentialType : bool {
    None,
    WebAuthn
};

enum class AutofillFieldName : uint8_t {
    None,
    Name,
    HonorificPrefix,
    GivenName,
    AdditionalName,
    FamilyName,
    HonorificSuffix,
    Nickname,
    Username,
    NewPassword,
    CurrentPassword,
    OrganizationTitle,
    Organization,
    StreetAddress,
    AddressLine1,
    AddressLine2,
    AddressLine3,
    AddressLevel4,
    AddressLevel3,
    AddressLevel2,
    AddressLevel1,
    Country,
    CountryName,
    PostalCode,
    CcName,
    CcGivenName,
    CcAdditionalName,
    CcFamilyName,
    CcNumber,
    CcExp,
    CcExpMonth,
    CcExpYear,
    CcCsc,
    CcType,
    TransactionCurrency,
    TransactionAmount,
    Language,
    Bday,
    BdayDay,
    BdayMonth,
    BdayYear,
    Sex,
    URL,
    Photo,
    Tel,
    TelCountryCode,
    TelNational,
    TelAreaCode,
    TelLocal,
    TelLocalPrefix,
    TelLocalSuffix,
    TelExtension,
    Email,
    Impp,
    WebAuthn,
    OneTimeCode,
    DeviceEID,
    DeviceIMEI,
    DeviceIMEI1,
    DeviceIMEI2,
    DeviceNAL,
};

WEBCORE_EXPORT AutofillFieldName toAutofillFieldName(const AtomString&);
WEBCORE_EXPORT String nonAutofillCredentialTypeString(NonAutofillCredentialType);

class HTMLFormControlElement;

class AutofillData {
public:
    static AutofillData createFromHTMLFormControlElement(const HTMLFormControlElement&);

    AutofillData(const AtomString& fieldName, const String& idlExposedValue, NonAutofillCredentialType nonAutofillCredentialType)
        : fieldName(fieldName)
        , idlExposedValue(idlExposedValue)
        , nonAutofillCredentialType(nonAutofillCredentialType)
    {
    }

    // We could add support for hint tokens and scope tokens if those ever became useful to anyone.

    AtomString fieldName;
    String idlExposedValue;
    NonAutofillCredentialType nonAutofillCredentialType;
};

} // namespace WebCore
