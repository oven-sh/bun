/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 * Copyright (C) 2003-2018 Apple Inc. All rights reserved.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public License
 * along with this library; see the file COPYING.LIB.  If not, write to
 * the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
 * Boston, MA 02110-1301, USA.
 */

#include "config.h"
#include "CharacterData.h"

#include "Document.h"
#include "ElementTraversal.h"
#include "MutationObserverInterestGroup.h"
#include "MutationRecord.h"
#include "NodeInlines.h"
#include <wtf/Ref.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(CharacterData);

CharacterData::~CharacterData() = default;

static bool LEGACY_NODELETE canUseSetDataOptimization(const CharacterData& node)
{
    return !node.document().hasMutationObserversOfType(MutationObserverOptionType::CharacterData);
}

void CharacterData::setData(const String& data)
{
    const String& nonNullData = !data.isNull() ? data : emptyString();
    unsigned oldLength = length();

    if (m_data == nonNullData && canUseSetDataOptimization(*this)) {
        protect(document())->textRemoved(*this, 0, oldLength);
        return;
    }

    Ref protectedThis { *this };
    setDataAndUpdate(nonNullData, 0, oldLength, nonNullData.length());
}

ExceptionOr<String> CharacterData::substringData(unsigned offset, unsigned count) const
{
    if (offset > length())
        return Exception { ExceptionCode::IndexSizeError };

    return m_data.substring(offset, count);
}

static ContainerNode::ChildChange::Type LEGACY_NODELETE textChildChangeType(unsigned oldLength, bool toEmpty)
{
    if (oldLength && !toEmpty)
        return ContainerNode::ChildChange::Type::TextChanged;
    return toEmpty ? ContainerNode::ChildChange::Type::TextRemoved : ContainerNode::ChildChange::Type::TextInserted;
}

static ContainerNode::ChildChange LEGACY_NODELETE makeChildChange(CharacterData& characterData, bool toEmpty, ContainerNode::ChildChange::Source source)
{
    return {
        textChildChangeType(characterData.length(), toEmpty),
        nullptr,
        nullptr,
        ElementTraversal::previousSibling(characterData),
        ElementTraversal::nextSibling(characterData),
        source,
        ContainerNode::ChildChange::AffectsElements::No
    };
}

void CharacterData::parserAppendData(StringView string, StringBuilder& buffer)
{
    auto childChange = makeChildChange(*this, false, ContainerNode::ChildChange::Source::Parser);

    unsigned oldLength = length();

    if (buffer.isEmpty() && !m_data.isEmpty())
        buffer.append(m_data);

    buffer.append(string);
    m_data = buffer.toStringPreserveCapacity();

    notifyParentAfterChange(childChange);

    auto mutationRecipients = MutationObserverInterestGroup::createForCharacterDataMutation(*this);
    if (mutationRecipients) [[unlikely]]
        mutationRecipients->enqueueMutationRecord(MutationRecord::createCharacterData(*this, m_data.left(oldLength)));
}

void CharacterData::appendData(const String& data)
{
    setDataAndUpdate(makeString(m_data, data), m_data.length(), 0, data.length(), UpdateLiveRanges::No);
}

ExceptionOr<void> CharacterData::insertData(unsigned offset, const String& data)
{
    if (offset > length())
        return Exception { ExceptionCode::IndexSizeError };

    auto newData = makeStringByInserting(m_data, data, offset);
    setDataAndUpdate(WTF::move(newData), offset, 0, data.length());

    return { };
}

ExceptionOr<void> CharacterData::deleteData(unsigned offset, unsigned count)
{
    if (offset > length())
        return Exception { ExceptionCode::IndexSizeError };

    count = std::min(count, length() - offset);

    auto newData = makeStringByRemoving(m_data, offset, count);
    setDataAndUpdate(WTF::move(newData), offset, count, 0);

    return { };
}

ExceptionOr<void> CharacterData::replaceData(unsigned offset, unsigned count, const String& data)
{
    if (offset > length())
        return Exception { ExceptionCode::IndexSizeError };

    count = std::min(count, length() - offset);

    StringView oldDataView { m_data };
    auto newData = makeString(oldDataView.left(offset), data, oldDataView.substring(offset + count));
    setDataAndUpdate(WTF::move(newData), offset, count, data.length());

    return { };
}

String CharacterData::nodeValue() const
{
    return m_data;
}

ExceptionOr<void> CharacterData::setNodeValue(const String& nodeValue)
{
    setData(nodeValue);
    return { };
}

void CharacterData::setDataWithoutUpdate(const String& data)
{
    ASSERT(!data.isNull());
    m_data = data;
}

void CharacterData::setDataAndUpdate(const String& newData, unsigned offsetOfReplacedData, unsigned oldLength, unsigned newLength, UpdateLiveRanges shouldUpdateLiveRanges)
{
    auto childChange = makeChildChange(*this, !newData.length(), ContainerNode::ChildChange::Source::API);

    String oldData = WTF::move(m_data);
    m_data = newData;

    Ref document = this->document();
    if (oldLength && shouldUpdateLiveRanges != UpdateLiveRanges::No)
        document->textRemoved(*this, offsetOfReplacedData, oldLength);
    if (newLength && shouldUpdateLiveRanges != UpdateLiveRanges::No)
        document->textInserted(*this, offsetOfReplacedData, newLength);

    notifyParentAfterChange(childChange);

    dispatchModifiedEvent(oldData);
}

void CharacterData::notifyParentAfterChange(const ContainerNode::ChildChange& childChange)
{
    document().incDOMTreeVersion();

    RefPtr parentNode = this->parentNode();
    if (!parentNode)
        return;

    parentNode->childrenChanged(childChange);
}

void CharacterData::dispatchModifiedEvent(const String& oldData)
{
    if (auto mutationRecipients = MutationObserverInterestGroup::createForCharacterDataMutation(*this))
        mutationRecipients->enqueueMutationRecord(MutationRecord::createCharacterData(*this, oldData));
}

} // namespace WebCore
