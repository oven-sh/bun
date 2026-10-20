/*
 * Copyright (C) 2010 Google, Inc. All rights reserved.
 * Copyright (C) 2011-2024 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY GOOGLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL GOOGLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 */

#include "config.h"
#include "HTMLElementStack.h"

#include "Document.h"
#include "DocumentFragment.h"
#include "ElementInlines.h"
#include "HTMLParserOptions.h"
#include "HTMLTemplateElement.h"
#include "MathMLNames.h"
#include "NodeDocument.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLElementStack);
WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLElementStack::ElementRecord);

using namespace ElementNames;

namespace {

inline bool LEGACY_NODELETE isRootNode(HTMLStackItem& item)
{
    return item.isDocumentFragment() || item.elementName() == HTML::html;
}

inline bool LEGACY_NODELETE isScopeMarker(HTMLStackItem& item)
{
    switch (item.elementName()) {
    case HTML::applet:
    case HTML::caption:
    case HTML::marquee:
    case HTML::object:
    case HTML::table:
    case HTML::td:
    case HTML::th:
    case HTML::template_:
    case MathML::mi:
    case MathML::mo:
    case MathML::mn:
    case MathML::ms:
    case MathML::mtext:
    case MathML::annotation_xml:
    case SVG::foreignObject:
    case SVG::desc:
    case SVG::title:
        return true;
    case HTML::select:
        return HTMLParserOptions::enhancedSelect;
    default:
        break;
    }
    return isRootNode(item);
}

inline bool LEGACY_NODELETE isListItemScopeMarker(HTMLStackItem& item)
{
    return isScopeMarker(item)
        || item.elementName() == HTML::ol
        || item.elementName() == HTML::ul;
}

inline bool LEGACY_NODELETE isTableScopeMarker(HTMLStackItem& item)
{
    return item.elementName() == HTML::table
        || item.elementName() == HTML::template_
        || isRootNode(item);
}

inline bool LEGACY_NODELETE isTableBodyScopeMarker(HTMLStackItem& item)
{
    return item.elementName() == HTML::tbody
        || item.elementName() == HTML::tfoot
        || item.elementName() == HTML::thead
        || item.elementName() == HTML::template_
        || isRootNode(item);
}

inline bool LEGACY_NODELETE isTableRowScopeMarker(HTMLStackItem& item)
{
    return item.elementName() == HTML::tr
        || item.elementName() == HTML::template_
        || isRootNode(item);
}

inline bool isForeignContentScopeMarker(HTMLStackItem& item)
{
    return HTMLElementStack::isMathMLTextIntegrationPoint(item)
        || HTMLElementStack::isHTMLIntegrationPoint(item)
        || isInHTMLNamespace(item);
}

inline bool LEGACY_NODELETE isButtonScopeMarker(HTMLStackItem& item)
{
    return isScopeMarker(item)
        || item.elementName() == HTML::button;
}

inline bool LEGACY_NODELETE isSelectScopeMarker(HTMLStackItem& item)
{
    return item.elementName() != HTML::optgroup
        && item.elementName() != HTML::option;
}

}

HTMLElementStack::ElementRecord::ElementRecord(HTMLStackItem&& item, std::unique_ptr<ElementRecord> next)
    : m_item(WTF::move(item))
    , m_next(WTF::move(next))
{
}

HTMLElementStack::ElementRecord::~ElementRecord() = default;

void HTMLElementStack::ElementRecord::replaceElement(HTMLStackItem&& item)
{
    ASSERT(m_item.isElement());
    // FIXME: Should this call finishParsingChildren?
    m_item = WTF::move(item);
}

bool HTMLElementStack::ElementRecord::isAbove(ElementRecord& other) const
{
    for (auto* below = next(); below; below = below->next()) {
        if (below == &other)
            return true;
    }
    return false;
}

HTMLElementStack::~HTMLElementStack() = default;

bool HTMLElementStack::hasOnlyOneElement() const
{
    return !topRecord().next();
}

bool HTMLElementStack::secondElementIsHTMLBodyElement() const
{
    // This is used the fragment case of <body> and <frameset> in the "in body"
    // insertion mode.
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/tokenization.html#parsing-main-inbody
    ASSERT(m_rootNode);
    // If we have a body element, it must always be the second element on the
    // stack, as we always start with an html element, and any other element
    // would cause the implicit creation of a body element.
    return !!m_bodyElement;
}

void HTMLElementStack::popHTMLHeadElement()
{
    ASSERT(&top() == m_headElement);
    m_headElement = nullptr;
    popCommon();
}

void HTMLElementStack::popHTMLBodyElement()
{
    ASSERT(&top() == m_bodyElement);
    m_bodyElement = nullptr;
    popCommon();
}

void HTMLElementStack::popAll()
{
    m_rootNode = nullptr;
    m_headElement = nullptr;
    m_bodyElement = nullptr;
    m_stackDepth = 0;
    while (m_top) {
        RefPtr element = dynamicDowncast<Element>(topNode());
        m_top = m_top->releaseNext();
        if (element)
            element->finishParsingChildren();
    }
}

void HTMLElementStack::pop()
{
    ASSERT(topStackItem().elementName() != HTML::head);
    popCommon();
}

void HTMLElementStack::popUntil(ElementName elementName)
{
    ASSERT(elementName != ElementName::Unknown);
    while (topStackItem().elementName() != elementName) {
        // pop() will ASSERT if a <body>, <head> or <html> will be popped.
        pop();
    }
}

void HTMLElementStack::popUntilPopped(ElementName elementName)
{
    popUntil(elementName);
    pop();
}

void HTMLElementStack::popUntilNumberedHeaderElementPopped()
{
    while (!isNumberedHeaderElement(topStackItem()))
        pop();
    pop();
}

void HTMLElementStack::popUntil(Element& element)
{
    while (&top() != &element)
        pop();
}

void HTMLElementStack::popUntilPopped(Element& element)
{
    popUntil(element);
    pop();
}

void HTMLElementStack::popUntilTableScopeMarker()
{
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/tokenization.html#clear-the-stack-back-to-a-table-context
    while (!isTableScopeMarker(topStackItem()))
        pop();
}

void HTMLElementStack::popUntilTableBodyScopeMarker()
{
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/tokenization.html#clear-the-stack-back-to-a-table-body-context
    while (!isTableBodyScopeMarker(topStackItem()))
        pop();
}

void HTMLElementStack::popUntilTableRowScopeMarker()
{
    // http://www.whatwg.org/specs/web-apps/current-work/multipage/tokenization.html#clear-the-stack-back-to-a-table-row-context
    while (!isTableRowScopeMarker(topStackItem()))
        pop();
}

// http://www.whatwg.org/specs/web-apps/current-work/multipage/tree-construction.html#mathml-text-integration-point
bool HTMLElementStack::isMathMLTextIntegrationPoint(HTMLStackItem& item)
{
    return item.elementName() == MathML::mi
        || item.elementName() == MathML::mo
        || item.elementName() == MathML::mn
        || item.elementName() == MathML::ms
        || item.elementName() == MathML::mtext;
}

// http://www.whatwg.org/specs/web-apps/current-work/multipage/tree-construction.html#html-integration-point
bool HTMLElementStack::isHTMLIntegrationPoint(HTMLStackItem& item)
{
    if (item.elementName() == MathML::annotation_xml) {
        // Read encoding off the element directly: m_attributes is unset for fragment-context items.
        RefPtr element = item.elementOrNull();
        if (!element)
            return false;
        auto& encoding = element->attributeWithoutSynchronization(MathMLNames::encodingAttr);
        return equalLettersIgnoringASCIICase(encoding, "text/html"_s)
            || equalLettersIgnoringASCIICase(encoding, "application/xhtml+xml"_s);
    }
    return item.elementName() == SVG::foreignObject
        || item.elementName() == SVG::desc
        || item.elementName() == SVG::title;
}

void HTMLElementStack::popUntilForeignContentScopeMarker()
{
    while (!isForeignContentScopeMarker(topStackItem()))
        pop();
}
    
void HTMLElementStack::pushRootNode(HTMLStackItem&& rootItem)
{
    ASSERT(rootItem.isDocumentFragment());
    pushRootNodeCommon(WTF::move(rootItem));
}

void HTMLElementStack::pushHTMLHtmlElement(HTMLStackItem&& item)
{
    ASSERT(item.elementName() == HTML::html);
    pushRootNodeCommon(WTF::move(item));
}
    
void HTMLElementStack::pushRootNodeCommon(HTMLStackItem&& rootItem)
{
    ASSERT(!m_top);
    ASSERT(!m_rootNode);
    m_rootNode = &rootItem.node();
    pushCommon(WTF::move(rootItem));
}

void HTMLElementStack::pushHTMLHeadElement(HTMLStackItem&& item)
{
    ASSERT(item.elementName() == HTML::head);
    ASSERT(!m_headElement);
    m_headElement = &item.element();
    pushCommon(WTF::move(item));
}

void HTMLElementStack::pushHTMLBodyElement(HTMLStackItem&& item)
{
    ASSERT(item.elementName() == HTML::body);
    ASSERT(!m_bodyElement);
    m_bodyElement = &item.element();
    pushCommon(WTF::move(item));
}

void HTMLElementStack::push(HTMLStackItem&& item)
{
    ASSERT(item.elementName() != HTML::html);
    ASSERT(item.elementName() != HTML::head);
    ASSERT(item.elementName() != HTML::body);
    ASSERT(m_rootNode);
    pushCommon(WTF::move(item));
}

void HTMLElementStack::insertAbove(HTMLStackItem&& item, ElementRecord& recordBelow)
{
    ASSERT(m_top);
    ASSERT(item.elementName() != HTML::html);
    ASSERT(item.elementName() != HTML::head);
    ASSERT(item.elementName() != HTML::body);
    ASSERT(m_rootNode);
    if (&recordBelow == m_top.get()) {
        push(WTF::move(item));
        return;
    }

    for (auto* recordAbove = m_top.get(); recordAbove; recordAbove = recordAbove->next()) {
        if (recordAbove->next() != &recordBelow)
            continue;

        ++m_stackDepth;
        recordAbove->setNext(makeUnique<ElementRecord>(WTF::move(item), recordAbove->releaseNext()));
        recordAbove->next()->element().beginParsingChildren();
        return;
    }
    ASSERT_NOT_REACHED();
}

auto HTMLElementStack::topRecord() const -> ElementRecord&
{
    ASSERT(m_top);
    return *m_top;
}

HTMLStackItem* HTMLElementStack::oneBelowTop() const
{
    // We should never call this if there are fewer than 2 elements on the stack.
    ASSERT(m_top);
    ASSERT(m_top->next());
    if (m_top->next()->stackItem().isElement())
        return &m_top->next()->stackItem();
    return nullptr;
}

void HTMLElementStack::removeHTMLHeadElement(Element& element)
{
    ASSERT(m_headElement == &element);
    if (&m_top->element() == &element) {
        popHTMLHeadElement();
        return;
    }
    m_headElement = nullptr;
    removeNonTopCommon(element);
}

void HTMLElementStack::remove(Element& element)
{
    ASSERT(element.elementName() != HTML::head);
    if (&m_top->element() == &element) {
        pop();
        return;
    }
    removeNonTopCommon(element);
}

auto HTMLElementStack::find(Element& element) const -> ElementRecord*
{
    for (auto* record = m_top.get(); record; record = record->next()) {
        if (&record->node() == &element)
            return record;
    }
    return nullptr;
}

auto HTMLElementStack::topmost(ElementName elementName) const -> ElementRecord*
{
    ASSERT(elementName != ElementName::Unknown);
    for (auto* record = m_top.get(); record; record = record->next()) {
        if (record->stackItem().elementName() == elementName)
            return record;
    }
    return nullptr;
}

bool HTMLElementStack::contains(Element& element) const
{
    return !!find(element);
}

template <bool isMarker(HTMLStackItem&)> bool LEGACY_NODELETE inScopeCommon(HTMLElementStack::ElementRecord* top, ElementName targetElement)
{
    ASSERT(targetElement != ElementName::Unknown);
    for (auto* record = top; record; record = record->next()) {
        auto& item = record->stackItem();
        if (item.elementName() == targetElement)
            return true;
        if (isMarker(item))
            return false;
    }
    ASSERT_NOT_REACHED(); // <html> is always on the stack and is a scope marker.
    return false;
}

bool HTMLElementStack::hasNumberedHeaderElementInScope() const
{
    for (auto* record = m_top.get(); record; record = record->next()) {
        auto& item = record->stackItem();
        if (isNumberedHeaderElement(item))
            return true;
        if (isScopeMarker(item))
            return false;
    }
    ASSERT_NOT_REACHED(); // <html> is always on the stack and is a scope marker.
    return false;
}

bool HTMLElementStack::inScope(Element& targetElement) const
{
    for (auto* record = m_top.get(); record; record = record->next()) {
        auto& item = record->stackItem();
        if (&item.node() == &targetElement)
            return true;
        if (isScopeMarker(item))
            return false;
    }
    ASSERT_NOT_REACHED(); // <html> is always on the stack and is a scope marker.
    return false;
}

bool HTMLElementStack::inScope(ElementName targetElement) const
{
    return inScopeCommon<isScopeMarker>(m_top.get(), targetElement);
}

bool HTMLElementStack::inListItemScope(ElementName targetElement) const
{
    return inScopeCommon<isListItemScopeMarker>(m_top.get(), targetElement);
}

bool HTMLElementStack::inTableScope(ElementName targetElement) const
{
    return inScopeCommon<isTableScopeMarker>(m_top.get(), targetElement);
}

bool HTMLElementStack::hasAnyInTableScope(std::initializer_list<ElementName> targetElements) const
{
    for (auto* record = m_top.get(); record; record = record->next()) {
        auto& item = record->stackItem();

        for (auto targetElement : targetElements) {
            if (item.elementName() == targetElement)
                return true;
        }

        if (isTableScopeMarker(item))
            return false;
    }
    ASSERT_NOT_REACHED();
    return false;
}

bool HTMLElementStack::inButtonScope(ElementName targetElement) const
{
    return inScopeCommon<isButtonScopeMarker>(m_top.get(), targetElement);
}

bool HTMLElementStack::inSelectScope(ElementName targetElement) const
{
    return inScopeCommon<isSelectScopeMarker>(m_top.get(), targetElement);
}

bool HTMLElementStack::hasTemplateInHTMLScope() const
{
    // The root is pushed first and never popped, and <template> can only be pushed above it, so the counter alone suffices.
    return m_templateElementCount;
}

Element& HTMLElementStack::htmlElement() const
{
    return downcast<Element>(rootNode());
}

Element& HTMLElementStack::headElement() const
{
    ASSERT(m_headElement);
    return *m_headElement;
}

Element& HTMLElementStack::bodyElement() const
{
    ASSERT(m_bodyElement);
    return *m_bodyElement;
}
    
ContainerNode& HTMLElementStack::rootNode() const
{
    ASSERT(m_rootNode);
    return *m_rootNode;
}

void HTMLElementStack::pushCommon(HTMLStackItem&& item)
{
    ASSERT(m_rootNode);

    if (is<HTMLTemplateElement>(item.node())) [[unlikely]]
        ++m_templateElementCount;

    ++m_stackDepth;
    m_top = makeUnique<ElementRecord>(WTF::move(item), WTF::move(m_top));
}

void HTMLElementStack::popCommon()
{
    ASSERT(topStackItem().elementName() != HTML::html);
    ASSERT(topStackItem().elementName() != HTML::head || !m_headElement);
    ASSERT(topStackItem().elementName() != HTML::body || !m_bodyElement);

    Ref oldTop = top();
    m_top = m_top->releaseNext();

    if (is<HTMLTemplateElement>(oldTop)) [[unlikely]] {
        ASSERT(m_templateElementCount);
        --m_templateElementCount;
    }

    oldTop->finishParsingChildren();

    --m_stackDepth;
}

void HTMLElementStack::removeNonTopCommon(Element& element)
{
    ASSERT(element.elementName() != HTML::html);
    ASSERT(element.elementName() != HTML::body);
    ASSERT(&top() != &element);
    for (auto* record = m_top.get(); record; record = record->next()) {
        if (&record->next()->element() == &element) {
            record->setNext(record->next()->releaseNext());
            --m_stackDepth;

            if (is<HTMLTemplateElement>(element)) [[unlikely]] {
                ASSERT(m_templateElementCount);
                --m_templateElementCount;
            }

            // FIXME: Is it OK to call finishParsingChildren()
            // when the children aren't actually finished?
            element.finishParsingChildren();
            return;
        }
    }
    ASSERT_NOT_REACHED();
}

auto HTMLElementStack::furthestBlockForFormattingElement(Element& formattingElement) const -> ElementRecord*
{
    ElementRecord* furthestBlock = nullptr;
    for (auto* record = m_top.get(); record; record = record->next()) {
        if (&record->element() == &formattingElement)
            return furthestBlock;
        if (isSpecialNode(record->stackItem()))
            furthestBlock = record;
    }
    ASSERT_NOT_REACHED();
    return nullptr;
}

#if ENABLE(TREE_DEBUGGING)

void HTMLElementStack::show()
{
    for (auto* record = m_top.get(); record; record = record->next())
        record->element().showNode();
}

#endif

}
