/*
 * Copyright (C) 2016 Apple Inc. All rights reserved.
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

#include "config.h"
#include "Autofill.h"

#include "CommonAtomStrings.h"
#include "ElementInlines.h"
#include "HTMLFormControlElement.h"
#include "HTMLFormElement.h"
#include "HTMLNames.h"
#include <wtf/Assertions.h>
#include <wtf/SortedArrayMap.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

enum class AutofillCategory : uint8_t { Off, Automatic, Normal, Contact, Credential };

struct AutofillFieldNameMapping {
    AutofillFieldName name;
    AutofillCategory category;
};

static constexpr SortedArrayMap fieldNameMap { WTF::toArray<std::pair<ComparableLettersLiteral, AutofillFieldNameMapping>>({
    { "additional-name"_s, { AutofillFieldName::AdditionalName, AutofillCategory::Normal } },
    { "address-level1"_s, { AutofillFieldName::AddressLevel1, AutofillCategory::Normal } },
    { "address-level2"_s, { AutofillFieldName::AddressLevel2, AutofillCategory::Normal } },
    { "address-level3"_s, { AutofillFieldName::AddressLevel3, AutofillCategory::Normal } },
    { "address-level4"_s, { AutofillFieldName::AddressLevel4, AutofillCategory::Normal } },
    { "address-line1"_s, { AutofillFieldName::AddressLine1, AutofillCategory::Normal } },
    { "address-line2"_s, { AutofillFieldName::AddressLine2, AutofillCategory::Normal } },
    { "address-line3"_s, { AutofillFieldName::AddressLine3, AutofillCategory::Normal } },
    { "bday"_s, { AutofillFieldName::Bday, AutofillCategory::Normal } },
    { "bday-day"_s, { AutofillFieldName::BdayDay, AutofillCategory::Normal } },
    { "bday-month"_s, { AutofillFieldName::BdayMonth, AutofillCategory::Normal } },
    { "bday-year"_s, { AutofillFieldName::BdayYear, AutofillCategory::Normal } },
    { "cc-additional-name"_s, { AutofillFieldName::CcAdditionalName, AutofillCategory::Normal } },
    { "cc-csc"_s, { AutofillFieldName::CcCsc, AutofillCategory::Normal } },
    { "cc-exp"_s, { AutofillFieldName::CcExp, AutofillCategory::Normal } },
    { "cc-exp-month"_s, { AutofillFieldName::CcExpMonth, AutofillCategory::Normal } },
    { "cc-exp-year"_s, { AutofillFieldName::CcExpYear, AutofillCategory::Normal } },
    { "cc-family-name"_s, { AutofillFieldName::CcFamilyName, AutofillCategory::Normal } },
    { "cc-given-name"_s, { AutofillFieldName::CcGivenName, AutofillCategory::Normal } },
    { "cc-name"_s, { AutofillFieldName::CcName, AutofillCategory::Normal } },
    { "cc-number"_s, { AutofillFieldName::CcNumber, AutofillCategory::Normal } },
    { "cc-type"_s, { AutofillFieldName::CcType, AutofillCategory::Normal } },
    { "country"_s, { AutofillFieldName::Country, AutofillCategory::Normal } },
    { "country-name"_s, { AutofillFieldName::CountryName, AutofillCategory::Normal } },
    { "current-password"_s, { AutofillFieldName::CurrentPassword, AutofillCategory::Normal } },
    { "device-eid"_s, { AutofillFieldName::DeviceEID, AutofillCategory::Normal } },
    { "device-imei"_s, { AutofillFieldName::DeviceIMEI, AutofillCategory::Normal } },
    { "device-imei1"_s, { AutofillFieldName::DeviceIMEI1, AutofillCategory::Normal } },
    { "device-imei2"_s, { AutofillFieldName::DeviceIMEI2, AutofillCategory::Normal } },
    { "device-nal"_s, { AutofillFieldName::DeviceNAL, AutofillCategory::Normal } },
    { "email"_s, { AutofillFieldName::Email, AutofillCategory::Contact } },
    { "family-name"_s, { AutofillFieldName::FamilyName, AutofillCategory::Normal } },
    { "given-name"_s, { AutofillFieldName::GivenName, AutofillCategory::Normal } },
    { "honorific-prefix"_s, { AutofillFieldName::HonorificPrefix, AutofillCategory::Normal } },
    { "honorific-suffix"_s, { AutofillFieldName::HonorificSuffix, AutofillCategory::Normal } },
    { "impp"_s, { AutofillFieldName::Impp, AutofillCategory::Contact } },
    { "language"_s, { AutofillFieldName::Language, AutofillCategory::Normal } },
    { "name"_s, { AutofillFieldName::Name, AutofillCategory::Normal } },
    { "new-password"_s, { AutofillFieldName::NewPassword, AutofillCategory::Normal } },
    { "nickname"_s, { AutofillFieldName::Nickname, AutofillCategory::Normal } },
    { "off"_s, { AutofillFieldName::None, AutofillCategory::Off } },
    { "on"_s, { AutofillFieldName::None, AutofillCategory::Automatic } },
    { "one-time-code"_s, { AutofillFieldName::OneTimeCode, AutofillCategory::Normal } },
    { "organization"_s, { AutofillFieldName::Organization, AutofillCategory::Normal } },
    { "organization-title"_s, { AutofillFieldName::OrganizationTitle, AutofillCategory::Normal } },
    { "photo"_s, { AutofillFieldName::Photo, AutofillCategory::Normal } },
    { "postal-code"_s, { AutofillFieldName::PostalCode, AutofillCategory::Normal } },
    { "sex"_s, { AutofillFieldName::Sex, AutofillCategory::Normal } },
    { "street-address"_s, { AutofillFieldName::StreetAddress, AutofillCategory::Normal } },
    { "tel"_s, { AutofillFieldName::Tel, AutofillCategory::Contact } },
    { "tel-area-code"_s, { AutofillFieldName::TelAreaCode, AutofillCategory::Contact } },
    { "tel-country-code"_s, { AutofillFieldName::TelCountryCode, AutofillCategory::Contact } },
    { "tel-extension"_s, { AutofillFieldName::TelExtension, AutofillCategory::Contact } },
    { "tel-local"_s, { AutofillFieldName::TelLocal, AutofillCategory::Contact } },
    { "tel-local-prefix"_s, { AutofillFieldName::TelLocalPrefix, AutofillCategory::Contact } },
    { "tel-local-suffix"_s, { AutofillFieldName::TelLocalSuffix, AutofillCategory::Contact } },
    { "tel-national"_s, { AutofillFieldName::TelNational, AutofillCategory::Contact } },
    { "transaction-amount"_s, { AutofillFieldName::TransactionAmount, AutofillCategory::Normal } },
    { "transaction-currency"_s, { AutofillFieldName::TransactionCurrency, AutofillCategory::Normal } },
    { "url"_s, { AutofillFieldName::URL, AutofillCategory::Normal } },
    { "username"_s, { AutofillFieldName::Username, AutofillCategory::Normal } },
    { "webauthn"_s, { AutofillFieldName::WebAuthn, AutofillCategory::Credential } },
}) };

AutofillFieldName toAutofillFieldName(const AtomString& value)
{
    return fieldNameMap.get(value).name;
}

String nonAutofillCredentialTypeString(NonAutofillCredentialType credentialType)
{
    switch (credentialType) {
    case NonAutofillCredentialType::None:
        return "none"_s;
    case NonAutofillCredentialType::WebAuthn:
        return "webauthn"_s;
    }
    return "none"_s;
}


static inline bool isContactToken(const AtomString& token)
{
    return token == "home"_s || token == "work"_s || token == "mobile"_s || token == "fax"_s || token == "pager"_s;
}

static unsigned LEGACY_NODELETE maxTokensForAutofillFieldCategory(AutofillCategory category)
{
    switch (category) {
    case AutofillCategory::Automatic:
    case AutofillCategory::Off:
        return 1;

    case AutofillCategory::Normal:
        return 3;

    case AutofillCategory::Contact:
        return 4;

    case AutofillCategory::Credential:
        return 5;
    }
    ASSERT_NOT_REACHED();
    return 0;
}

// https://html.spec.whatwg.org/multipage/forms.html#processing-model-3
AutofillData AutofillData::createFromHTMLFormControlElement(const HTMLFormControlElement& element)
{
    // Label: Default
    // 26. Let the element's IDL-exposed autofill value be the empty string, and its autofill hint set and autofill scope be empty.
    // 27. If the element's autocomplete attribute is wearing the autofill anchor mantle, then let the element's autofill field name be the empty string and abort these steps.
    // 28. Let form be the element's form owner, if any, or null otherwise.
    // 29. If form is not null and form's autocomplete attribute is in the off state, then let the element's autofill field name be "off". Otherwise, let the element's autofill field name be "on".
    auto defaultLabel = [&] () -> AutofillData {
        if (element.autofillMantle() == AutofillMantle::Anchor)
            return { emptyAtom(), emptyString(), NonAutofillCredentialType::None };
        
        RefPtr form = element.form();
        if (form && form->autocomplete() == offAtom())
            return { offAtom(), emptyString(), NonAutofillCredentialType::None };
        return { onAtom(), emptyString(), NonAutofillCredentialType::None };
    };


    const AtomString& attributeValue = element.attributeWithoutSynchronization(HTMLNames::autocompleteAttr);

    // 1. If the element has no autocomplete attribute, then jump to the step labeled default.
    if (attributeValue.isNull())
        return defaultLabel();

    // 2. Let tokens be the result of splitting the attribute's value on spaces.
    SpaceSplitString tokens(attributeValue, SpaceSplitString::ShouldFoldCase::Yes);

    // 3. If tokens is empty, then jump to the step labeled default.
    if (tokens.isEmpty())
        return defaultLabel();
    
    // 4. Let index be the index of the last token in tokens
    unsigned index = tokens.size() - 1;

    // 5. If the indexth token in tokens is not an ASCII case-insensitive match for one of the
    // tokens given in the first column of the following table, or if the number of tokens in
    // tokens is greater than the maximum number given in the cell in the second column of that
    // token's row, then jump to the step labeled default. Otherwise, let field be the string given
    // in the cell of the first column of the matching row, and let category be the value of the
    // cell in the third column of that same row.

    auto mapEntry = fieldNameMap.tryGet(tokens[index]);
    if (!mapEntry)
        return defaultLabel();
    
    auto category = mapEntry->category;

    if (tokens.size() > maxTokensForAutofillFieldCategory(category))
        return defaultLabel();

    const auto& field = tokens[index];

    // 6. If category is Off or Automatic but the element's autocomplete attribute is wearing the
    // autofill anchor mantle, then jump to the step labeled default.
    auto mantle = element.autofillMantle();
    if ((category == AutofillCategory::Off || category == AutofillCategory::Automatic) && mantle == AutofillMantle::Anchor)
        return defaultLabel();

    // 7. If category is Off, let the element's autofill field name be the string "off", let its
    // autofill hint set be empty, and let its IDL-exposed autofill value be the string "off".
    // Then, abort these steps.
    if (category == AutofillCategory::Off)
        return { offAtom(), offAtom().string(), NonAutofillCredentialType::None };

    // 8. If category is Automatic, let the element's autofill field name be the string "on",
    // let its autofill hint set be empty, and let its IDL-exposed autofill value be the string
    // "on". Then, abort these steps.
    if (category == AutofillCategory::Automatic)
        return { onAtom(), onAtom().string(), NonAutofillCredentialType::None };

    // 9. Let scope tokens be an empty list.
    // 10. Let hint tokens be an empty set.

    // NOTE: We are ignoring these steps as we don't currently make use of scope tokens or hint tokens anywhere.

    // 11. Let IDL value have the same value as field.
    String idlValue = field;

    // If category is Credential and the indexth token in tokens is an ASCII case-insensitive match for "webauthn", then run the substeps that follow:
    NonAutofillCredentialType credentialType { NonAutofillCredentialType::None };
    if (category == AutofillCategory::Credential && field == "webauthn"_s) {
        // 1. Set credential type to "webauthn".
        credentialType = NonAutofillCredentialType::WebAuthn;
        // 2. If the indexth token in tokens is the first entry, then skip to the step labeled done.
        if (!index)
            return { field, idlValue, credentialType };
        // 3. Decrement index by one.
        index--;
        // 4. Set the category, maximum tokens pair to the result of determining a field's category given the indexth token in tokens.
        auto mapEntry = fieldNameMap.tryGet(tokens[index]);
        if (!mapEntry)
            return defaultLabel();

        category = mapEntry->category;
        // 5. If category is not Normal and category is not Contact, then jump to the step labeled default.
        if (category != AutofillCategory::Normal && category != AutofillCategory::Contact)
            return defaultLabel();
        // 6. If index is greater than maximum tokens minus one (i.e. if the number of remaining tokens is
        // greater than maximum tokens), then jump to the step labeled default
        if (index > maxTokensForAutofillFieldCategory(category) - 1)
            return defaultLabel();
        idlValue = makeString(tokens[index], ' ', idlValue);
    }

    // 12, If the indexth token in tokens is the first entry, then skip to the step labeled done.
    if (index == 0)
        return { field, idlValue, credentialType };

    // 13. Decrement index by one
    index--;

    // 14. If category is Contact and the indexth token in tokens is an ASCII case-insensitive match
    // for one of the strings in the following list, then run the substeps that follow:
    const auto& contactToken = tokens[index];
    if (category == AutofillCategory::Contact && isContactToken(contactToken)) {
        // 1. Let contact be the matching string from the list above.
        const auto& contact = contactToken;

        // 2. Insert contact at the start of scope tokens.
        // 3. Add contact to hint tokens.

        // NOTE: We are ignoring these steps as we don't currently make use of scope tokens or hint tokens anywhere.

        // 4. Let IDL value be the concatenation of contact, a U+0020 SPACE character, and the previous
        // value of IDL value (which at this point will always be field).
        idlValue = makeString(contact, ' ', idlValue);

        // 5. If the indexth entry in tokens is the first entry, then skip to the step labeled done.
        if (index == 0)
            return { field, idlValue, credentialType };

        // 6. Decrement index by one.
        index--;
    }

    // 15. If the indexth token in tokens is an ASCII case-insensitive match for one of the strings
    // in the following list, then run the substeps that follow:
    const auto& modeToken = tokens[index];
    if (equalLettersIgnoringASCIICase(modeToken, "shipping"_s) || equalLettersIgnoringASCIICase(modeToken, "billing"_s)) {
        // 1. Let mode be the matching string from the list above.
        const auto& mode = modeToken;

        // 2. Insert mode at the start of scope tokens.
        // 3. Add mode to hint tokens.

        // NOTE: We are ignoring these steps as we don't currently make use of scope tokens or hint tokens anywhere.

        // 4. Let IDL value be the concatenation of mode, a U+0020 SPACE character, and the previous
        // value of IDL value (which at this point will either be field or the concatenation of contact,
        // a space, and field).
        idlValue = makeString(mode, ' ', idlValue);

        // 5. If the indexth entry in tokens is the first entry, then skip to the step labeled done.
        if (index == 0)
            return { field, idlValue, credentialType };

        // 6. Decrement index by one.
        index--;
    }

    // 16. If the indexth entry in tokens is not the first entry, then jump to the step labeled default.
    if (index != 0)
        return defaultLabel();

    // 17. If the first eight characters of the indexth token in tokens are not an ASCII case-insensitive
    // match for the string "section-", then jump to the step labeled default.
    const auto& sectionToken = tokens[index];
    if (!startsWithLettersIgnoringASCIICase(sectionToken, "section-"_s))
        return defaultLabel();

    // 18. Let section be the indexth token in tokens, converted to ASCII lowercase.
    const auto& section = sectionToken;

    // 19. Insert section at the start of scope tokens.

    // NOTE: We are ignoring this step as we don't currently make use of scope tokens or hint tokens anywhere.

    // 20. Let IDL value be the concatenation of section, a U+0020 SPACE character, and the previous
    // value of IDL value.
    idlValue = makeString(section, ' ', idlValue);

    return { field, idlValue, credentialType };
}

} // namespace WebCore
