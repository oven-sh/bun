/*
 * Copyright (C) 2013 Google, Inc. All rights reserved.
 * Copyright (C) 2015 Apple Inc. All rights reserved.
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

#include "HTMLNameCache.h"
#include "HTMLNames.h"
#include "HTMLToken.h"
#include "TagName.h"
#include <wtf/HashSet.h>
#include <wtf/text/AtomStringHash.h>

namespace WebCore {

class AtomHTMLToken {
public:
    using Type = HTMLToken::Type;

    AtomHTMLToken(HTMLToken&, HTMLNameCache&);
    AtomHTMLToken(Type, TagName, const AtomString& name, Vector<Attribute>&& = { }); // Only StartTag or EndTag.
    AtomHTMLToken(Type, TagName, Vector<Attribute>&& = { }); // Only StartTag or EndTag.

    AtomHTMLToken(const AtomHTMLToken&) = delete;
    AtomHTMLToken(AtomHTMLToken&&) = default;

    Type type() const;

    // StartTag, EndTag, DOCTYPE.

    void setTagName(TagName);

    const AtomString& name() const LIFETIME_BOUND;

    // DOCTYPE.

    bool forceQuirks() const;
    String publicIdentifier() const;
    String systemIdentifier() const;

    // StartTag, EndTag.

    Vector<Attribute>& attributes() LIFETIME_BOUND;

    TagName tagName() const;
    bool selfClosing() const;
    void setSelfClosingToFalse();
    const Vector<Attribute>& attributes() const LIFETIME_BOUND;

    // Characters

    std::span<const char16_t> characters() const;
    bool charactersIsAll8BitData() const;

    // Comment

    const String& comment() const LIFETIME_BOUND;
    String& comment() LIFETIME_BOUND;

    bool hasDuplicateAttribute() const { return m_hasDuplicateAttribute; }

private:
    void initializeAttributes(const HTMLToken::AttributeList& attributes, HTMLNameCache&);

    AtomString m_name; // StartTag, EndTag, DOCTYPE.
    String m_data; // Comment
    std::unique_ptr<DoctypeData> m_doctypeData; // DOCTYPE.
    Vector<Attribute> m_attributes; // StartTag, EndTag.

    // We don't want to copy the characters out of the HTMLToken, so we keep a pointer to its buffer instead.
    // This buffer is owned by the HTMLToken and causes a lifetime dependence between these objects.
    // FIXME: Add a mechanism for "internalizing" the characters when the HTMLToken is destroyed.
    std::span<const char16_t> m_externalCharacters; // Character

    Type m_type;
    TagName m_tagName; // StartTag, EndTag.
    bool m_externalCharactersIsAll8BitData; // Character
    bool m_selfClosing { false }; // StartTag, EndTag.
    bool m_hasDuplicateAttribute { false };
};

const Attribute* findAttribute(const Vector<Attribute>&, const QualifiedName&);
bool hasAttribute(const Vector<Attribute>&, const AtomString& localName);

inline auto AtomHTMLToken::type() const -> Type
{
    return m_type;
}

inline const AtomString& AtomHTMLToken::name() const
{
    ASSERT(m_type == Type::StartTag || m_type == Type::EndTag || m_type == Type::DOCTYPE);
    if (!m_name.isNull())
        return m_name;

    ASSERT(m_type == Type::StartTag || m_type == Type::EndTag);
    ASSERT(m_tagName != TagName::Unknown);
    return tagNameAsString(m_tagName);
}

inline void AtomHTMLToken::setTagName(TagName tagName)
{
    ASSERT(m_type == Type::StartTag || m_type == Type::EndTag);
    ASSERT(tagName != TagName::Unknown);
    m_tagName = tagName;
}

inline TagName AtomHTMLToken::tagName() const
{
    ASSERT(m_type == Type::StartTag || m_type == Type::EndTag);
    return m_tagName;
}

inline bool AtomHTMLToken::selfClosing() const
{
    ASSERT(m_type == Type::StartTag || m_type == Type::EndTag);
    return m_selfClosing;
}

inline void AtomHTMLToken::setSelfClosingToFalse()
{
    ASSERT(m_selfClosing);
    ASSERT(m_type == Type::StartTag);
    ASSERT(m_tagName == TagName::script);
    m_selfClosing = false;
}

inline Vector<Attribute>& AtomHTMLToken::attributes()
{
    ASSERT(m_type == Type::StartTag || m_type == Type::EndTag);
    return m_attributes;
}

inline const Vector<Attribute>& AtomHTMLToken::attributes() const
{
    ASSERT(m_type == Type::StartTag || m_type == Type::EndTag);
    return m_attributes;
}

inline std::span<const char16_t> AtomHTMLToken::characters() const
{
    ASSERT(m_type == Type::Character);
    return m_externalCharacters;
}

inline bool AtomHTMLToken::charactersIsAll8BitData() const
{
    ASSERT(m_type == Type::Character);
    return m_externalCharactersIsAll8BitData;
}

inline const String& AtomHTMLToken::comment() const
{
    ASSERT(m_type == Type::Comment);
    return m_data;
}

inline String& AtomHTMLToken::comment()
{
    ASSERT(m_type == Type::Comment);
    return m_data;
}

inline bool AtomHTMLToken::forceQuirks() const
{
    ASSERT(m_type == Type::DOCTYPE);
    return m_doctypeData->forceQuirks;
}

inline String AtomHTMLToken::publicIdentifier() const
{
    ASSERT(m_type == Type::DOCTYPE);
    if (!m_doctypeData->hasPublicIdentifier)
        return String();
    return StringImpl::create8BitIfPossible(m_doctypeData->publicIdentifier);
}

inline String AtomHTMLToken::systemIdentifier() const
{
    if (!m_doctypeData->hasSystemIdentifier)
        return String();
    return StringImpl::create8BitIfPossible(m_doctypeData->systemIdentifier);
}

inline const Attribute* findAttribute(const Vector<Attribute>& attributes, const QualifiedName& name)
{
    for (auto& attribute : attributes) {
        if (attribute.name().matches(name))
            return &attribute;
    }
    return nullptr;
}

inline bool hasAttribute(const Vector<Attribute>& attributes, const AtomString& localName)
{
    for (auto& attribute : attributes) {
        if (attribute.localName() == localName)
            return true;
    }
    return false;
}

inline void AtomHTMLToken::initializeAttributes(const HTMLToken::AttributeList& attributes, HTMLNameCache& nameCache)
{
    unsigned size = attributes.size();
    if (!size)
        return;

    Vector<AtomStringImpl*, 8> addedAttributes;
    addedAttributes.reserveInitialCapacity(size);

    m_attributes = WTF::compactMap(attributes, [&](auto& attribute) -> std::optional<Attribute> {
        if (attribute.name.isEmpty())
            return std::nullopt;

        auto qualifiedName = nameCache.makeAttributeQualifiedName(attribute.name);
        if (!insertInUniquedSortedVector(addedAttributes, qualifiedName.localName().impl())) [[unlikely]] {
            m_hasDuplicateAttribute = true;
            return std::nullopt;
        }

        return Attribute(WTF::move(qualifiedName), nameCache.makeAttributeValue(attribute.value));
    });
}

inline AtomHTMLToken::AtomHTMLToken(HTMLToken& token, HTMLNameCache& nameCache)
    : m_type(token.type())
{
    switch (m_type) {
    case Type::Uninitialized:
        ASSERT_NOT_REACHED();
        return;
    case Type::DOCTYPE:
        if (token.name().size() == 4 && equal(HTMLNames::htmlTag->localName().impl(), token.name().span())) [[likely]]
            m_name = HTMLNames::htmlTag->localName();
        else
            m_name = AtomString(token.name().span());
        m_doctypeData = token.releaseDoctypeData();
        return;
    case Type::EndOfFile:
        return;
    case Type::StartTag:
    case Type::EndTag:
        m_selfClosing = token.selfClosing();
        m_tagName = findTagName(token.name());
        if (m_tagName == TagName::Unknown) [[unlikely]]
            m_name = AtomString(token.name().span());
        initializeAttributes(token.attributes(), nameCache);
        return;
    case Type::Comment: {
        if (token.commentIsAll8BitData())
            m_data = String::make8Bit(token.comment().span());
        else
            m_data = token.comment().span();
        return;
    }
    case Type::Character:
        m_externalCharacters = token.characters().span();
        m_externalCharactersIsAll8BitData = token.charactersIsAll8BitData();
        return;
    }
    ASSERT_NOT_REACHED();
}

inline AtomHTMLToken::AtomHTMLToken(HTMLToken::Type type, TagName tagName, const AtomString& name, Vector<Attribute>&& attributes)
    : m_name(name)
    , m_attributes(WTF::move(attributes))
    , m_type(type)
    , m_tagName(tagName)
{
    ASSERT(type == Type::StartTag || type == Type::EndTag);
    ASSERT(findTagName(name) == tagName);
}

inline AtomHTMLToken::AtomHTMLToken(HTMLToken::Type type, TagName tagName, Vector<Attribute>&& attributes)
    : m_attributes(WTF::move(attributes))
    , m_type(type)
    , m_tagName(tagName)
{
    ASSERT(type == Type::StartTag || type == Type::EndTag);
    ASSERT(tagName != TagName::Unknown);
}

} // namespace WebCore
