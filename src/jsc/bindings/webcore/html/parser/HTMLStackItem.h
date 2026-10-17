/*
 * Copyright (C) 2012 Company 100, Inc. All rights reserved.
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

#pragma once

#include "AtomHTMLToken.h"
#include "DocumentFragment.h"
#include "Element.h"
#include "Namespace.h"
#include "NodeName.h"
#include "TagName.h"

namespace WebCore {

class HTMLStackItem {
public:
    HTMLStackItem() = default;

    // Normal HTMLElementStack and HTMLFormattingElementList items.
    HTMLStackItem(Ref<Element>&&, AtomHTMLToken&&);
    HTMLStackItem(Ref<Element>&&, Vector<Attribute>&&);

    // Document fragment or element for parsing context.
    explicit HTMLStackItem(Element&);
    explicit HTMLStackItem(DocumentFragment&);

    bool isNull() const { return !m_node; }
    bool isElement() const { return m_node && is<Element>(*m_node); }
    bool isDocumentFragment() const { return m_node && is<DocumentFragment>(*m_node); }

    ContainerNode& node() const { return *m_node; }
    Element& element() const { return downcast<Element>(node()); }
    Element* elementOrNull() const { return downcast<Element>(m_node.get()); }

    const AtomString& localName() const LIFETIME_BOUND { return isElement() ? element().localName() : nullAtom(); }
    const AtomString& namespaceURI() const LIFETIME_BOUND { return isElement() ? element().namespaceURI() : nullAtom(); }

    ElementName elementName() const { return m_elementName; }
    Namespace nodeNamespace() const { return m_namespace; }

    const Vector<Attribute>& attributes() const LIFETIME_BOUND;
    const Attribute* findAttribute(const QualifiedName& attributeName) const LIFETIME_BOUND;

    bool matchesHTMLTag(const AtomString&) const;

private:
    ElementName m_elementName = ElementName::Unknown;
    Namespace m_namespace = Namespace::Unknown;
    RefPtr<ContainerNode> m_node;
    Vector<Attribute> m_attributes;
};

bool isInHTMLNamespace(const HTMLStackItem&);
bool isNumberedHeaderElement(const HTMLStackItem&);
bool isSpecialNode(const HTMLStackItem&);

inline HTMLStackItem::HTMLStackItem(Ref<Element>&& element, AtomHTMLToken&& token)
    : m_elementName(element->elementName())
    , m_namespace(element->nodeNamespace())
    , m_node(WTF::move(element))
    , m_attributes(WTF::move(token.attributes()))
{
}

inline HTMLStackItem::HTMLStackItem(Ref<Element>&& element, Vector<Attribute>&& attributes)
    : m_elementName(element->elementName())
    , m_namespace(element->nodeNamespace())
    , m_node(WTF::move(element))
    , m_attributes(WTF::move(attributes))
{
}

inline HTMLStackItem::HTMLStackItem(Element& element)
    : m_elementName(element.elementName())
    , m_namespace(element.nodeNamespace())
    , m_node(&element)
{
}

inline HTMLStackItem::HTMLStackItem(DocumentFragment& fragment)
    : m_node(&fragment)
{
}

inline const Vector<Attribute>& HTMLStackItem::attributes() const
{
    ASSERT(isElement());
    return m_attributes;
}

inline const Attribute* HTMLStackItem::findAttribute(const QualifiedName& attributeName) const
{
    return WebCore::findAttribute(const_cast<Vector<Attribute>&>(attributes()), attributeName);
}

inline bool HTMLStackItem::matchesHTMLTag(const AtomString& name) const
{
    return localName() == name && m_namespace == Namespace::HTML;
}

inline bool isInHTMLNamespace(const HTMLStackItem& item)
{
    // A DocumentFragment takes the place of the document element when parsing
    // fragments and thus should be treated as if it was in the HTML namespace.
    // FIXME: Is this also needed for a ShadowRoot that might be a non-HTML element?
    return item.nodeNamespace() == Namespace::HTML || item.isDocumentFragment();
}

inline bool isNumberedHeaderElement(const HTMLStackItem& item)
{
    using namespace ElementNames;

    switch (item.elementName()) {
    case HTML::h1:
    case HTML::h2:
    case HTML::h3:
    case HTML::h4:
    case HTML::h5:
    case HTML::h6:
        return true;
    default:
        return false;
    }
}

// https://html.spec.whatwg.org/multipage/parsing.html#special
inline bool isSpecialNode(const HTMLStackItem& item)
{
    using namespace ElementNames;

    if (item.isDocumentFragment())
        return true;

    switch (item.elementName()) {
    case HTML::address:
    case HTML::applet:
    case HTML::area:
    case HTML::article:
    case HTML::aside:
    case HTML::base:
    case HTML::basefont:
    case HTML::bgsound:
    case HTML::blockquote:
    case HTML::body:
    case HTML::br:
    case HTML::button:
    case HTML::caption:
    case HTML::center:
    case HTML::col:
    case HTML::colgroup:
    case HTML::dd:
    case HTML::details:
    case HTML::dir:
    case HTML::div:
    case HTML::dl:
    case HTML::dt:
    case HTML::embed:
    case HTML::fieldset:
    case HTML::figcaption:
    case HTML::figure:
    case HTML::footer:
    case HTML::form:
    case HTML::frame:
    case HTML::frameset:
    case HTML::h1:
    case HTML::h2:
    case HTML::h3:
    case HTML::h4:
    case HTML::h5:
    case HTML::h6:
    case HTML::head:
    case HTML::header:
    case HTML::hgroup:
    case HTML::hr:
    case HTML::html:
    case HTML::iframe:
    case HTML::img:
    case HTML::input:
    case HTML::li:
    case HTML::link:
    case HTML::listing:
    case HTML::main:
    case HTML::marquee:
    case HTML::menu:
    case HTML::meta:
    case HTML::nav:
    case HTML::noembed:
    case HTML::noframes:
    case HTML::noscript:
    case HTML::object:
    case HTML::ol:
    case HTML::p:
    case HTML::param:
    case HTML::plaintext:
    case HTML::pre:
    case HTML::script:
    case HTML::section:
    case HTML::select:
    case HTML::style:
    case HTML::summary:
    case HTML::table:
    case HTML::tbody:
    case HTML::td:
    case HTML::template_:
    case HTML::textarea:
    case HTML::tfoot:
    case HTML::th:
    case HTML::thead:
    case HTML::tr:
    case HTML::ul:
    case HTML::wbr:
    case HTML::xmp:
    case MathML::annotation_xml:
    case MathML::mi:
    case MathML::mo:
    case MathML::mn:
    case MathML::ms:
    case MathML::mtext:
    case SVG::desc:
    case SVG::foreignObject:
    case SVG::title:
        return true;
    default:
        return false;
    }
}

} // namespace WebCore
