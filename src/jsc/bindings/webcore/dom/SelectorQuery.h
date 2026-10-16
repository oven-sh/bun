/*
 * Copyright (C) 2011-2018 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "CSSSelectorList.h"
#include "Element.h"
#include "ExceptionOr.h"
#include "NodeList.h"
#include <wtf/HashMap.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/Vector.h>
#include <wtf/text/AtomStringHash.h>
#include <wtf/text/StringHash.h>

namespace WebCore {

class CSSSelector;
class ContainerNode;
class Document;
class Element;

class SelectorDataList {
public:
    explicit SelectorDataList(const CSSSelectorList&);
    bool matches(Element&) const;
    RefPtr<Element> closest(Element&) const;
    Ref<NodeList> queryAll(ContainerNode& rootNode) const;
    Element* queryFirst(ContainerNode& rootNode) const;

    bool shouldStoreInDocument() const { return m_matchType == MatchType::TagNameMatch || m_matchType == MatchType::ClassNameMatch; }
    AtomString LEGACY_NODELETE classNameToMatch() const;

private:
    struct SelectorData {
        const CSSSelector& selector;
    };

    bool selectorMatches(const SelectorData&, Element&, const ContainerNode& rootNode) const;

    template <typename OutputType> void execute(ContainerNode& rootNode, OutputType&) const;
    template <typename OutputType> void executeFastPathForIdSelector(const ContainerNode& rootNode, const SelectorData&, const CSSSelector* idSelector, OutputType&) const;
    template <typename OutputType> void executeSingleTagNameSelectorData(const ContainerNode& rootNode, const SelectorData&, OutputType&) const;
    template <typename OutputType> void executeSingleClassNameSelectorData(const ContainerNode& rootNode, const SelectorData&, OutputType&) const;
    template <typename OutputType> void executeSingleAttributeExactSelectorData(const ContainerNode& rootNode, const SelectorData&, OutputType&) const;
    template <typename OutputType> void executeSingleSelectorData(const ContainerNode& rootNode, const ContainerNode& searchRootNode, const SelectorData&, OutputType&) const;
    template <typename OutputType> void executeSingleMultiSelectorData(const ContainerNode& rootNode, OutputType&) const;

    FixedVector<SelectorData> m_selectors;
    enum class MatchType : uint8_t {
        SingleSelector,
        SingleSelectorWithRootFilter,
        RightMostWithIdMatch,
        TagNameMatch,
        ClassNameMatch,
        AttributeExactMatch,
        MultipleSelectorMatch,
    };
    mutable MatchType m_matchType;
};

class SelectorQuery {
    WTF_MAKE_TZONE_ALLOCATED(SelectorQuery);
    WTF_MAKE_NONCOPYABLE(SelectorQuery);

public:
    explicit SelectorQuery(CSSSelectorList&&);
    bool matches(Element&) const;
    RefPtr<Element> closest(Element&) const;
    Ref<NodeList> queryAll(ContainerNode& rootNode) const;
    Element* queryFirst(ContainerNode& rootNode) const;

    bool shouldStoreInDocument() const { return m_selectors.shouldStoreInDocument(); }
    AtomString classNameToMatch() const { return m_selectors.classNameToMatch(); }

private:
    CSSSelectorList m_selectorList;
    SelectorDataList m_selectors;
};

class SelectorQueryCache {
    WTF_MAKE_TZONE_ALLOCATED(SelectorQueryCache);
public:
    SelectorQueryCache() = default;

    SelectorQuery* add(const String&, const Document&);
    void clear();

private:
    using Entries = HashMap<String, std::unique_ptr<SelectorQuery>>;
    Entries m_entries;
    Entries m_quirksModeEntries;
};

inline bool SelectorQuery::matches(Element& element) const
{
    return m_selectors.matches(element);
}

inline RefPtr<Element> SelectorQuery::closest(Element& element) const
{
    return m_selectors.closest(element);
}

inline Ref<NodeList> SelectorQuery::queryAll(ContainerNode& rootNode) const
{
    return m_selectors.queryAll(rootNode);
}

inline Element* SelectorQuery::queryFirst(ContainerNode& rootNode) const
{
    return m_selectors.queryFirst(rootNode);
}

} // namespace WebCore
