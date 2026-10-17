/*
 * Copyright (C) 2008, 2009, 2010, 2014, 2016 Apple Inc. All rights reserved.
 * Copyright (C) 2008 David Smith <catfish.man@gmail.com>
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
 *
 */

#pragma once

#include "Attr.h"
#include "CustomElementDefaultARIA.h"
#include "CustomElementReactionQueue.h"
#include "CustomElementRegistry.h"
#include "CustomStateSet.h"
#include "DOMTokenList.h"
#include "DatasetDOMStringMap.h"
#include "Element.h"
#include "EventTarget.h"
#include "NamedNodeMap.h"
#include "NodeRareData.h"
#include "PopoverData.h"
#include "SpaceSplitString.h"
#include <wtf/HashMap.h>

namespace WebCore {

class FormAssociatedCustomElement;

class ElementRareData : public NodeRareData {
public:
    explicit ElementRareData();
    ~ElementRareData();

    int unusualTabIndex() const;
    void setUnusualTabIndex(int);

    CustomElementReactionQueue* customElementReactionQueue() { return m_customElementReactionQueue.get(); }
    void initializeCustomElementReactionQueue(std::unique_ptr<CustomElementReactionQueue>&& queue) { lazyInitialize(m_customElementReactionQueue, WTF::move(queue)); }

    CustomElementRegistry* scopedCustomElementRegistry() const { return m_scopedCustomElementRegistry.get(); }
    void setScopedCustomElementRegistry(RefPtr<CustomElementRegistry>&& registry) { m_scopedCustomElementRegistry = WTF::move(registry); }

    CustomElementDefaultARIA* customElementDefaultARIA() { return m_customElementDefaultARIA.get(); }
    void initializeCustomElementDefaultARIA(std::unique_ptr<CustomElementDefaultARIA>&& defaultARIA) { lazyInitialize(m_customElementDefaultARIA, WTF::move(defaultARIA)); }

    FormAssociatedCustomElement* formAssociatedCustomElement() { return m_formAssociatedCustomElement.get(); }
    void initializeFormAssociatedCustomElement(const std::unique_ptr<FormAssociatedCustomElement>&&);

    NamedNodeMap* attributeMap() const { return m_attributeMap.get(); }
    void setAttributeMap(const std::unique_ptr<NamedNodeMap>&& attributeMap) { lazyInitialize(m_attributeMap, std::move(attributeMap)); }

    Vector<Ref<Attr>>& attrNodeList() LIFETIME_BOUND { return m_attrNodeList; }

    const AtomString& effectiveLang() const LIFETIME_BOUND { return m_effectiveLang; }
    void setEffectiveLang(const AtomString& lang) { m_effectiveLang = lang; }

    DOMTokenList* classList() const { return m_classList.get(); }
    void setClassList(const std::unique_ptr<DOMTokenList>&& classList) { lazyInitialize(m_classList, std::move(classList)); }

    DatasetDOMStringMap* dataset() const { return m_dataset.get(); }
    void setDataset(const std::unique_ptr<DatasetDOMStringMap>&& dataset) { lazyInitialize(m_dataset, std::move(dataset)); }

    int scrollLeft() const { return m_scrollLeft; }
    void setScrollLeft(int scrollLeft) { m_scrollLeft = scrollLeft; }

    int scrollTop() const { return m_scrollTop; }
    void setScrollTop(int scrollTop) { m_scrollTop = scrollTop; }

    DOMTokenList* partList() const { return m_partList.get(); }
    void setPartList(const std::unique_ptr<DOMTokenList>&& partList) { lazyInitialize(m_partList, std::move(partList)); }

    const SpaceSplitString& partNames() const LIFETIME_BOUND { return m_partNames; }
    void setPartNames(SpaceSplitString&& partNames) { m_partNames = WTF::move(partNames); }

    const AtomString& nonce() const LIFETIME_BOUND { return m_nonce; }
    void setNonce(const AtomString& value) { m_nonce = value; }

    ExplicitlySetAttrElementsMap& explicitlySetAttrElementsMap() LIFETIME_BOUND { return m_explicitlySetAttrElementsMap; }

    PopoverData* popoverData() const LIFETIME_BOUND { return m_popoverData.get(); }
    void setPopoverData(std::unique_ptr<PopoverData>&& popoverData) { m_popoverData = WTF::move(popoverData); }

    Element* invokedPopover() const { return m_invokedPopover.get(); }
    void setInvokedPopover(RefPtr<Element>&& element) { m_invokedPopover = WTF::move(element); }

    CustomStateSet* customStateSet() { return m_customStateSet.get(); }
    void initializeCustomStateSet(Ref<CustomStateSet>&& customStateSet) { lazyInitialize(m_customStateSet, WTF::move(customStateSet)); }

#if DUMP_NODE_STATISTICS
    OptionSet<UseType> useTypes() const
    {
        auto result = NodeRareData::useTypes();
        if (m_unusualTabIndex)
            result.add(UseType::TabIndex);
        if (m_scrollLeft || m_scrollTop)
            result.add(UseType::ScrollingPosition);
        if (!m_effectiveLang.isEmpty())
            result.add(UseType::EffectiveLang);
        if (m_dataset)
            result.add(UseType::Dataset);
        if (m_classList)
            result.add(UseType::ClassList);
        if (m_customElementReactionQueue)
            result.add(UseType::CustomElementReactionQueue);
        if (m_customElementDefaultARIA)
            result.add(UseType::CustomElementDefaultARIA);
        if (m_formAssociatedCustomElement)
            result.add(UseType::FormAssociatedCustomElement);
        if (m_attributeMap)
            result.add(UseType::AttributeMap);
        if (m_partList)
            result.add(UseType::PartList);
        if (!m_partNames.isEmpty())
            result.add(UseType::PartNames);
        if (!m_nonce.isEmpty())
            result.add(UseType::Nonce);
        if (!m_explicitlySetAttrElementsMap.isEmpty())
            result.add(UseType::ExplicitlySetAttrElementsMap);
        if (m_popoverData)
            result.add(UseType::Popover);
        if (m_customStateSet)
            result.add(UseType::CustomStateSet);
        if (m_invokedPopover)
            result.add(UseType::InvokedPopover);
        return result;
    }
#endif

private:
    int m_unusualTabIndex { 0 }; // Keep on top for better bit packing with NodeRareData.

    int m_scrollLeft { 0 };
    int m_scrollTop { 0 };

    AtomString m_effectiveLang;
    const std::unique_ptr<DatasetDOMStringMap> m_dataset;
    const std::unique_ptr<DOMTokenList> m_classList;
    const std::unique_ptr<CustomElementReactionQueue> m_customElementReactionQueue;
    RefPtr<CustomElementRegistry> m_scopedCustomElementRegistry;
    const std::unique_ptr<CustomElementDefaultARIA> m_customElementDefaultARIA;
    const std::unique_ptr<FormAssociatedCustomElement> m_formAssociatedCustomElement;
    const std::unique_ptr<NamedNodeMap> m_attributeMap;
    Vector<Ref<Attr>> m_attrNodeList;

    const std::unique_ptr<DOMTokenList> m_partList;
    SpaceSplitString m_partNames;

    AtomString m_nonce;

    ExplicitlySetAttrElementsMap m_explicitlySetAttrElementsMap;

    std::unique_ptr<PopoverData> m_popoverData;

    WeakPtr<Element, WeakPtrImplWithEventTargetData> m_invokedPopover;

    const RefPtr<CustomStateSet> m_customStateSet;
};

inline int ElementRareData::unusualTabIndex() const
{
    ASSERT(m_unusualTabIndex); // setUnusualTabIndex must have been called before this.
    return m_unusualTabIndex;
}

inline void ElementRareData::setUnusualTabIndex(int tabIndex)
{
    ASSERT(tabIndex && tabIndex != -1); // Common values of 0 and -1 are stored as TabIndexState in Node.
    m_unusualTabIndex = tabIndex;
}

inline ElementRareData* Element::elementRareData() const
{
    ASSERT_WITH_SECURITY_IMPLICATION(hasRareData());
    return downcast<ElementRareData>(rareData());
}

} // namespace WebCore

SPECIALIZE_TYPE_TRAITS_BEGIN(WebCore::ElementRareData)
    static bool isType(const WebCore::NodeRareData& rareData) { return rareData.isElementRareData(); }
SPECIALIZE_TYPE_TRAITS_END()
