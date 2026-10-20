/*
 * Copyright (C) 2025 Apple Inc. All rights reserved.
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
#include "NameValidation.h"

#include "CommonAtomStrings.h"
#include "ExceptionOr.h"
#include "QualifiedName.h"
#include "XMLNSNames.h"
#include "XMLNames.h"
#include <wtf/text/MakeString.h>
#include <wtf/text/StringView.h>

namespace WebCore::NameValidation {

// https://dom.spec.whatwg.org/#validate-and-extract

static constexpr bool LEGACY_NODELETE isInvalidAttributeNameCharacter(char16_t c)
{
    return !c || isASCIIWhitespace(c) || c == '/' || c == '>' || c == '=';
}

static constexpr bool LEGACY_NODELETE isInvalidElementNameCharacterAfterAlphaStart(char16_t c)
{
    return !c || isASCIIWhitespace(c) || c == '/' || c == '>';
}

static constexpr bool LEGACY_NODELETE isValidElementNameContinuationCharacter(char16_t c)
{
    return isASCIIAlphanumeric(c) || c == '-' || c == '.' || c == ':' || c == '_' || !isASCII(c);
}

static constexpr bool LEGACY_NODELETE isInvalidNamespacePrefixCharacter(char16_t c)
{
    return !c || isASCIIWhitespace(c) || c == '/' || c == '>';
}

static constexpr bool LEGACY_NODELETE isInvalidDoctypeNameCharacter(char16_t c)
{
    return !c || isASCIIWhitespace(c) || c == '>';
}

static constexpr bool LEGACY_NODELETE isValidASCIIXMLNamePart(char16_t c)
{
    return isASCIIAlphanumeric(c) || c == ':' || c == '_' || c == '-' || c == '.';
}

// https://dom.spec.whatwg.org/#valid-element-name
bool isValidElementName(StringView name)
{
    if (name.isEmpty())
        return false;

    auto firstCharacter = name[0];

    if (isASCIIAlpha(firstCharacter))
        return !name.contains(isInvalidElementNameCharacterAfterAlphaStart);

    if (firstCharacter == ':' || firstCharacter == '_' || firstCharacter >= 0x80)
        return name.containsOnly<isValidElementNameContinuationCharacter>();

    return false;
}

bool isValidElementName(const QualifiedName& name)
{
    return isValidElementName(name.localName());
}

// https://dom.spec.whatwg.org/#valid-attribute-name
bool isValidAttributeName(StringView name)
{
    return !name.isEmpty() && !name.contains(isInvalidAttributeNameCharacter);
}

// https://dom.spec.whatwg.org/#valid-namespace-prefix
static bool isValidNamespacePrefix(StringView prefix)
{
    return !prefix.isEmpty() && !prefix.contains(isInvalidNamespacePrefixCharacter);
}

// https://dom.spec.whatwg.org/#valid-doctype-name
bool isValidDoctypeName(StringView name)
{
    return !name.contains(isInvalidDoctypeNameCharacter);
}

static inline bool LEGACY_NODELETE isValidASCIIXMLName(StringView name)
{
    if (name.isEmpty())
        return false;

    auto firstCharacter = name[0];
    if (!isASCIIAlpha(firstCharacter) && firstCharacter != ':' && firstCharacter != '_')
        return false;

    return name.containsOnly<isValidASCIIXMLNamePart>();
}

// https://www.w3.org/TR/xml/#NT-NameStartChar
// NameStartChar ::= ":" | [A-Z] | "_" | [a-z] | [#xC0-#xD6] | [#xD8-#xF6] | [#xF8-#x2FF] | [#x370-#x37D] | [#x37F-#x1FFF] | [#x200C-#x200D] | [#x2070-#x218F] | [#x2C00-#x2FEF] | [#x3001-#xD7FF] | [#xF900-#xFDCF] | [#xFDF0-#xFFFD] | [#x10000-#xEFFFF]
static inline bool LEGACY_NODELETE isValidXMLNameStart(char32_t c)
{
    return c == ':' || isASCIIAlpha(c) || c == '_' || (c >= 0x00C0 && c <= 0x00D6)
        || (c >= 0x00D8 && c <= 0x00F6) || (c >= 0x00F8 && c <= 0x02FF) || (c >= 0x0370 && c <= 0x037D) || (c >= 0x037F && c <= 0x1FFF)
        || (c >= 0x200C && c <= 0x200D) || (c >= 0x2070 && c <= 0x218F) || (c >= 0x2C00 && c <= 0x2FEF) || (c >= 0x3001 && c <= 0xD7FF)
        || (c >= 0xF900 && c <= 0xFDCF) || (c >= 0xFDF0 && c <= 0xFFFD) || (c >= 0x10000 && c <= 0xEFFFF);
}

// https://www.w3.org/TR/xml/#NT-NameChar
// NameChar ::= NameStartChar | "-" | "." | [0-9] | #xB7 | [#x0300-#x036F] | [#x203F-#x2040]
static inline bool LEGACY_NODELETE isValidXMLNamePart(char32_t c)
{
    return isValidXMLNameStart(c) || c == '-' || c == '.' || isASCIIDigit(c) || c == 0x00B7
        || (c >= 0x0300 && c <= 0x036F) || (c >= 0x203F && c <= 0x2040);
}

// https://www.w3.org/TR/xml/#NT-Name
bool isValidXMLName(StringView name)
{
    if (isValidASCIIXMLName(name))
        return true;

    bool isFirst = true;
    for (auto codePoint : name.codePoints()) {
        if (isFirst) {
            if (!isValidXMLNameStart(codePoint))
                return false;
            isFirst = false;
        } else {
            if (!isValidXMLNamePart(codePoint))
                return false;
        }
    }
    return !isFirst; // false if empty (no characters processed)
}

enum class QualifiedNameType : bool { Element, Attribute };

static ExceptionOr<std::pair<AtomString, AtomString>> parseQualifiedNameToPair(const AtomString& qualifiedName, QualifiedNameType type)
{
    if (qualifiedName.isEmpty())
        return Exception { ExceptionCode::InvalidCharacterError };

    auto firstColonPosition = qualifiedName.find(':');
    if (firstColonPosition == notFound) {
        bool isValidLocal = type == QualifiedNameType::Element
            ? isValidElementName(qualifiedName)
            : isValidAttributeName(qualifiedName);
        if (!isValidLocal)
            return Exception { ExceptionCode::InvalidCharacterError, makeString("Invalid name: '"_s, qualifiedName, '\'') };
        return std::pair<AtomString, AtomString> { nullAtom(), qualifiedName };
    }

    auto prefix = StringView { qualifiedName }.left(firstColonPosition);
    if (!isValidNamespacePrefix(prefix))
        return Exception { ExceptionCode::InvalidCharacterError, makeString("Invalid namespace prefix in '"_s, qualifiedName, '\'') };

    auto localName = StringView { qualifiedName }.substring(firstColonPosition + 1);

    if (localName.isEmpty())
        return Exception { ExceptionCode::InvalidCharacterError, makeString("Invalid local name in '"_s, qualifiedName, '\'') };

    bool isValidLocal = type == QualifiedNameType::Element
        ? isValidElementName(localName)
        : isValidAttributeName(localName);
    if (!isValidLocal)
        return Exception { ExceptionCode::InvalidCharacterError, makeString("Invalid local name in '"_s, qualifiedName, '\'') };

    return std::pair<AtomString, AtomString> { prefix.toAtomString(), localName.toAtomString() };
}

ExceptionOr<QualifiedName> parseQualifiedElementName(const AtomString& namespaceURI, const AtomString& qualifiedName)
{
    auto parseResult = parseQualifiedNameToPair(qualifiedName, QualifiedNameType::Element);
    if (parseResult.hasException())
        return parseResult.releaseException();
    auto [prefix, localName] = parseResult.releaseReturnValue();
    return QualifiedName { prefix, localName, namespaceURI };
}

ExceptionOr<QualifiedName> parseQualifiedAttributeName(const AtomString& namespaceURI, const AtomString& qualifiedName)
{
    auto parseResult = parseQualifiedNameToPair(qualifiedName, QualifiedNameType::Attribute);
    if (parseResult.hasException())
        return parseResult.releaseException();
    auto [prefix, localName] = parseResult.releaseReturnValue();
    return QualifiedName { prefix, localName, namespaceURI };
}

ExceptionOr<std::pair<AtomString, AtomString>> parseQualifiedAttributeName(const AtomString& qualifiedName)
{
    return parseQualifiedNameToPair(qualifiedName, QualifiedNameType::Attribute);
}

// These checks are from DOM Core Level 2, createElementNS
// http://www.w3.org/TR/DOM-Level-2-Core/core.html#ID-DocCrElNS
bool hasValidNamespaceForElements(const QualifiedName& qName)
{
    if (!qName.prefix().isEmpty() && qName.namespaceURI().isNull()) // createElementNS(null, "html:div")
        return false;
    if (qName.prefix() == xmlAtom() && qName.namespaceURI() != XMLNames::xmlNamespaceURI) // createElementNS("http://www.example.com", "xml:lang")
        return false;

    // Required by DOM Level 3 Core and unspecified by DOM Level 2 Core:
    // http://www.w3.org/TR/2004/REC-DOM-Level-3-Core-20040407/core.html#ID-DocCrElNS
    // createElementNS("http://www.w3.org/2000/xmlns/", "foo:bar"), createElementNS(null, "xmlns:bar"), createElementNS(null, "xmlns")
    if (qName.prefix() == xmlnsAtom() || (qName.prefix().isEmpty() && qName.localName() == xmlnsAtom()))
        return qName.namespaceURI() == XMLNSNames::xmlnsNamespaceURI;
    return qName.namespaceURI() != XMLNSNames::xmlnsNamespaceURI;
}

bool hasValidNamespaceForAttributes(const QualifiedName& qName)
{
    return hasValidNamespaceForElements(qName);
}

} // namespace WebCore::NameValidation
