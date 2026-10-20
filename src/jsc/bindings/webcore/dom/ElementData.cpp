/*
 * Copyright (C) 2013, 2014 Apple Inc. All rights reserved.
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
#include "ElementData.h"

#include "Attr.h"
#include "Element.h"
#include "HTMLNames.h"
#include "ImmutableStyleProperties.h"
#include "MutableStyleProperties.h"
#include "StyleProperties.h"
#include "XMLNames.h"
#include <wtf/ZippedRange.h>

namespace WebCore {

DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(ElementData);
DEFINE_ALLOCATOR_WITH_HEAP_IDENTIFIER(ShareableElementData);

void ElementData::destroy()
{
    if (auto* uniqueData = dynamicDowncast<UniqueElementData>(*this))
        delete uniqueData;
    else
        delete uncheckedDowncast<ShareableElementData>(this);
}

ElementData::ElementData()
    : m_arraySizeAndFlags(s_flagIsUnique)
{
}

ElementData::ElementData(unsigned arraySize)
    : m_arraySizeAndFlags(arraySize << s_flagCount)
{
}

struct SameSizeAsElementData : public RefCounted<SameSizeAsElementData> {
    unsigned bitfield;
    void* refPtrs[3];
};

static_assert(sizeof(ElementData) == sizeof(SameSizeAsElementData), "element attribute data should stay small");

static size_t LEGACY_NODELETE sizeForShareableElementDataWithAttributeCount(unsigned count)
{
    return sizeof(ShareableElementData) + sizeof(Attribute) * count;
}

Ref<ShareableElementData> ShareableElementData::createWithAttributes(std::span<const Attribute> attributes)
{
    void* slot = ShareableElementDataMalloc::malloc(sizeForShareableElementDataWithAttributeCount(attributes.size()));
    return adoptRef(*new (NotNull, slot) ShareableElementData(attributes));
}

Ref<UniqueElementData> UniqueElementData::create()
{
    return adoptRef(*new UniqueElementData);
}

ShareableElementData::ShareableElementData(std::span<const Attribute> attributes)
    : ElementData(attributes.size())
{
    for (auto [sourceAttribute, destinationAttribute] : zippedRange(attributes, this->attributes()))
        new (NotNull, &destinationAttribute) Attribute(sourceAttribute);
}

ShareableElementData::~ShareableElementData()
{
    for (auto& attribute : attributes())
        attribute.~Attribute();
}

ShareableElementData::ShareableElementData(const UniqueElementData& other)
    : ElementData(other, false)
{
    if (other.m_inlineStyle) {
        ASSERT(!other.m_inlineStyle->hasCSSOMWrapper());
        m_inlineStyle = protect(other.m_inlineStyle)->immutableCopyIfNeeded();
    }

    for (auto [sourceAttribute, destinationAttribute] : zippedRange(other.m_attributeVector.span(), attributes()))
        new (NotNull, &destinationAttribute) Attribute(sourceAttribute);
}

inline uint32_t ElementData::arraySizeAndFlagsFromOther(const ElementData& other, bool isUnique)
{
    if (isUnique) {
        // Set isUnique and ignore arraySize.
        return (other.m_arraySizeAndFlags | s_flagIsUnique) & s_flagsMask;
    }
    // Clear isUnique and set arraySize.
    return (other.m_arraySizeAndFlags & (s_flagsMask & ~s_flagIsUnique)) | other.length() << s_flagCount;
}

ElementData::ElementData(const ElementData& other, bool isUnique)
    : m_arraySizeAndFlags(ElementData::arraySizeAndFlagsFromOther(other, isUnique))
    , m_classNames(other.m_classNames)
    , m_idForStyleResolution(other.m_idForStyleResolution)
{
    // NOTE: The inline style is copied by the subclass copy constructor since we don't know what to do with it here.
}

UniqueElementData::UniqueElementData() = default;

UniqueElementData::UniqueElementData(const UniqueElementData& other)
    : ElementData(other, true)
    , m_attributeVector(other.m_attributeVector)
{
    if (other.m_inlineStyle)
        m_inlineStyle = protect(other.m_inlineStyle)->mutableCopy();
}

UniqueElementData::UniqueElementData(const ShareableElementData& other)
    : ElementData(other, true)
    , m_attributeVector(other.attributes())
{
    // An ShareableElementData should never have a mutable inline StyleProperties attached.
    ASSERT(!other.m_inlineStyle || !other.m_inlineStyle->isMutable());
    m_inlineStyle = other.m_inlineStyle;
}

Ref<UniqueElementData> ElementData::makeUniqueCopy() const
{
    if (auto* uniqueData = dynamicDowncast<const UniqueElementData>(*this))
        return adoptRef(*new UniqueElementData(*uniqueData));
    return adoptRef(*new UniqueElementData(downcast<const ShareableElementData>(*this)));
}

Ref<ShareableElementData> UniqueElementData::makeShareableCopy() const
{
    void* slot = ShareableElementDataMalloc::malloc(sizeForShareableElementDataWithAttributeCount(m_attributeVector.size()));
    return adoptRef(*new (NotNull, slot) ShareableElementData(*this));
}

bool ElementData::isEquivalent(const ElementData* other) const
{
    if (!other)
        return isEmpty();

    if (length() != other->length())
        return false;

    for (auto& attribute : attributes()) {
        auto* otherAttr = other->findAttributeByName(attribute.name());
        if (!otherAttr || attribute.value() != otherAttr->value())
            return false;
    }

    return true;
}

Attribute* LEGACY_NODELETE UniqueElementData::findAttributeByName(const QualifiedName& name)
{
    for (auto& attribute : m_attributeVector) {
        if (attribute.name().matches(name))
            return &attribute;
    }
    return nullptr;
}

}
