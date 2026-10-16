/*
 * Copyright (C) 2010-2026 Apple Inc. All rights reserved.
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
#include "DatasetDOMStringMap.h"

#include "ElementInlines.h"
#include "ScriptWrappableInlines.h"
#include <wtf/ASCIICType.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/AtomString.h>
#include <wtf/text/StringBuilder.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(DatasetDOMStringMap);

static bool isValidAttributeName(const String& name)
{
    if (!name.startsWith("data-"_s))
        return false;

    unsigned length = name.length();
    for (unsigned i = 5; i < length; ++i) {
        if (isASCIIUpper(name[i]))
            return false;
    }

    return true;
}

static String convertAttributeNameToPropertyName(const String& name)
{
    StringBuilder stringBuilder;

    unsigned length = name.length();
    for (unsigned i = 5; i < length; ++i) {
        char16_t character = name[i];
        if (character != '-')
            stringBuilder.append(character);
        else {
            if ((i + 1 < length) && isASCIILower(name[i + 1])) {
                stringBuilder.append(toASCIIUpper(name[i + 1]));
                ++i;
            } else
                stringBuilder.append(character);
        }
    }

    return stringBuilder.toString();
}

static bool LEGACY_NODELETE isValidPropertyName(const String& name)
{
    unsigned length = name.length();
    for (unsigned i = 0; i < length; ++i) {
        if (name[i] == '-' && (i + 1 < length) && isASCIILower(name[i + 1]))
            return false;
    }
    return true;
}

template<typename CharacterType>
static inline AtomString convertPropertyNameToAttributeName(const StringImpl& name)
{
    static constexpr auto dataPrefix = WTF::toArray<CharacterType>({ 'd', 'a', 't', 'a', '-' });

    Vector<CharacterType, 32> buffer;

    unsigned length = name.length();
    buffer.reserveInitialCapacity(dataPrefix.size() + length);

    buffer.append(std::span { dataPrefix });

    auto characters = name.span<CharacterType>();
    for (auto character : characters) {
        if (isASCIIUpper(character)) {
            buffer.append('-');
            buffer.append(toASCIILower(character));
        } else
            buffer.append(character);
    }
    return buffer.span();
}

static AtomString convertPropertyNameToAttributeName(const String& name)
{
    if (name.isNull())
        return nullAtom();

    StringImpl* nameImpl = name.impl();
    if (nameImpl->is8Bit())
        return convertPropertyNameToAttributeName<Latin1Character>(*nameImpl);
    return convertPropertyNameToAttributeName<char16_t>(*nameImpl);
}

void DatasetDOMStringMap::ref()
{
    m_element->ref();
}

void DatasetDOMStringMap::deref()
{
    m_element->deref();
}

bool DatasetDOMStringMap::isSupportedPropertyName(const String& propertyName) const
{
    Ref element = m_element.get();
    if (!element->hasAttributes())
        return false;

    auto attributes = element->attributes();
    if (attributes.size() == 1) {
        // Avoid creating AtomString when there is only one attribute.
        auto& attribute = attributes[0];
        if (isValidAttributeName(attribute.localName()) && convertAttributeNameToPropertyName(attribute.localName()) == propertyName)
            return true;
    } else {
        if (!isValidPropertyName(propertyName))
            return false;
        auto attributeName = convertPropertyNameToAttributeName(propertyName);
        for (auto& attribute : attributes) {
            if (attribute.localName() == attributeName)
                return true;
        }
    }
    
    return false;
}

Vector<String> DatasetDOMStringMap::supportedPropertyNames() const
{
    Vector<String> names;

    Ref element = m_element.get();
    if (!element->hasAttributes())
        return names;

    for (auto& attribute : element->attributes()) {
        if (isValidAttributeName(attribute.localName()))
            names.append(convertAttributeNameToPropertyName(attribute.localName()));
    }

    return names;
}

const AtomString* DatasetDOMStringMap::item(const String& propertyName) const
{
    Ref element = m_element.get();
    if (element->hasAttributes()) {
        auto attributes = element->attributes();

        if (attributes.size() == 1) {
            // Avoid creating AtomString when there is only one attribute.
            auto& attribute = attributes[0];
            if (isValidAttributeName(attribute.localName()) && convertAttributeNameToPropertyName(attribute.localName()) == propertyName)
                return &attribute.value();
        } else {
            if (!isValidPropertyName(propertyName))
                return nullptr;
            AtomString attributeName = convertPropertyNameToAttributeName(propertyName);
            for (auto& attribute : attributes) {
                if (attribute.localName() == attributeName)
                    return &attribute.value();
            }
        }
    }

    return nullptr;
}

String DatasetDOMStringMap::namedItem(const AtomString& name) const
{
    if (const auto* value = item(name))
        return *value;
    return String { };
}

ExceptionOr<void> DatasetDOMStringMap::setNamedItem(const String& name, const AtomString& value)
{
    if (!isValidPropertyName(name))
        return Exception { ExceptionCode::SyntaxError };
    return protect(element())->setAttribute(convertPropertyNameToAttributeName(name), value);
}

bool DatasetDOMStringMap::deleteNamedProperty(const String& name)
{
    return protect(element())->removeAttribute(convertPropertyNameToAttributeName(name));
}

DatasetDOMStringMap::~DatasetDOMStringMap() = default;

} // namespace WebCore
