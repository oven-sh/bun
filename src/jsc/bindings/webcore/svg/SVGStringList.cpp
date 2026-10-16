/*
 * Copyright (C) 2020-2024 Apple Inc. All rights reserved.
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
#include "SVGStringList.h"

#include "ElementInlines.h"
#include "SVGElement.h"
#include <wtf/TZoneMallocInlines.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(SVGStringList);

SVGStringList::SVGStringList(SVGElement& contextElement, StaticQualifiedName attributeName, char delimiter)
    : m_contextElement(contextElement)
    , m_attributeName(attributeName)
    , m_delimiter(delimiter)
{
}

SVGStringList::~SVGStringList() = default;

Ref<SVGStringList> SVGStringList::create(SVGElement& contextElement, StaticQualifiedName attributeName, char delimiter)
{
    return adoptRef(*new SVGStringList(contextElement, attributeName, delimiter));
}

// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#set-of-comma-separated-tokens
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#set-of-space-separated-tokens
Vector<String> SVGStringList::items() const
{
    Vector<String> items;
    auto data = StringView { m_contextElement->attributeWithoutSynchronization(m_attributeName) }.trim(isASCIIWhitespace<char16_t>);
    if (data.isEmpty())
        return items;

    if (m_delimiter == ',') {
        for (auto token : data.splitAllowingEmptyEntries(','))
            items.append(token.trim(isASCIIWhitespace<char16_t>).toString());
        return items;
    }

    unsigned start = 0;
    for (unsigned i = 0; i <= data.length(); ++i) {
        if (i < data.length() && !isASCIIWhitespace(data[i]))
            continue;
        if (i > start)
            items.append(data.substring(start, i - start).toString());
        start = i + 1;
    }
    return items;
}

void SVGStringList::setItems(const Vector<String>& items)
{
    auto delimiter = m_delimiter == ',' ? ", "_s : " "_s;
    m_contextElement->setAttributeWithoutSynchronization(m_attributeName, AtomString { makeString(interleave(items, delimiter)) });
}

void SVGStringList::clear()
{
    setItems({ });
}

ExceptionOr<String> SVGStringList::getItem(unsigned index)
{
    auto items = this->items();
    if (index >= items.size())
        return Exception { ExceptionCode::IndexSizeError };
    return WTF::move(items[index]);
}

String SVGStringList::initialize(String&& newItem)
{
    setItems({ newItem });
    return WTF::move(newItem);
}

String SVGStringList::insertItemBefore(String&& newItem, unsigned index)
{
    auto items = this->items();

    // Spec: If the index is greater than or equal to numberOfItems,
    // then the new item is appended to the end of the list.
    items.insert(std::min<unsigned>(index, items.size()), newItem);
    setItems(items);
    return WTF::move(newItem);
}

ExceptionOr<String> SVGStringList::replaceItem(String&& newItem, unsigned index)
{
    auto items = this->items();
    if (index >= items.size())
        return Exception { ExceptionCode::IndexSizeError };

    items[index] = newItem;
    setItems(items);
    return WTF::move(newItem);
}

ExceptionOr<String> SVGStringList::removeItem(unsigned index)
{
    auto items = this->items();
    if (index >= items.size())
        return Exception { ExceptionCode::IndexSizeError };

    auto item = WTF::move(items[index]);
    items.removeAt(index);
    setItems(items);
    return item;
}

String SVGStringList::appendItem(String&& newItem)
{
    auto items = this->items();
    items.append(newItem);
    setItems(items);
    return WTF::move(newItem);
}

ExceptionOr<void> SVGStringList::setItem(unsigned index, String&& newItem)
{
    auto result = replaceItem(WTF::move(newItem), index);
    if (result.hasException())
        return result.releaseException();
    return { };
}

}
