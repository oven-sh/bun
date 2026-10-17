/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2025 Apple Inc. All rights reserved.
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
#include "DocumentFragment.h"

#include "ContainerNodeInlines.h"
#include "Document.h"
#include "ElementIterator.h"
#include "HTMLDocumentParser.h"
#include "HTMLDocumentParserFastPath.h"
#include "TypedElementDescendantIteratorInlines.h"
#include "XMLDocumentParser.h"
#include "markup.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(DocumentFragment);

DocumentFragment::DocumentFragment(Document& document, OptionSet<TypeFlag> typeFlags)
    : ContainerNode(document, NodeType::DocumentFragment, typeFlags)
{
    if (document.usesNullCustomElementRegistry())
        setUsesNullCustomElementRegistry();
}

Ref<DocumentFragment> DocumentFragment::create(Document& document)
{
    return adoptRef(*new DocumentFragment(document));
}

Ref<DocumentFragment> DocumentFragment::createForInnerOuterHTML(Document& document)
{
    auto node = adoptRef(*new DocumentFragment(document, { TypeFlag::IsPseudoElementOrSpecialInternalNode }));
    ASSERT(node->isDocumentFragmentForInnerOuterHTML());
    return node;
}

String DocumentFragment::nodeName() const
{
    return "#document-fragment"_s;
}

bool DocumentFragment::childTypeAllowed(NodeType type) const
{
    switch (type) {
    case NodeType::Element:
    case NodeType::ProcessingInstruction:
    case NodeType::Comment:
    case NodeType::Text:
    case NodeType::CDATASection:
        return true;
    default:
        return false;
    }
}

Ref<Node> DocumentFragment::cloneNodeInternal(Document& document, CloningOperation type, CustomElementRegistry* registry) const
{
    Ref clone = create(document);
    switch (type) {
    case CloningOperation::SelfOnly:
    case CloningOperation::SelfWithTemplateContent:
        break;
    case CloningOperation::Everything:
        cloneChildNodes(document, registry, clone);
        break;
    }
    return clone;
}

void DocumentFragment::parseHTML(const String& source, Element& contextElement, OptionSet<ParserContentPolicy> parserContentPolicy, CustomElementRegistry* registry)
{
    Ref document = this->document();
    if (!registry && !usesNullCustomElementRegistry() && tryFastParsingHTMLFragment(source, document, *this, contextElement, parserContentPolicy)) {
        setWasParsedWithFastPath();
#if ASSERT_ENABLED
        // As a sanity check for the fast-path, create another fragment using the full parser and compare the results.
        auto referenceFragment = DocumentFragment::create(document);
        HTMLDocumentParser::parseDocumentFragment(source, referenceFragment, contextElement, parserContentPolicy);
        ASSERT(serializeFragment(*this, SerializedNodes::SubtreesOfChildren) == serializeFragment(referenceFragment, SerializedNodes::SubtreesOfChildren));
#endif
        return;
    }
    clearWasParsedWithFastPath();
    if (hasChildNodes())
        removeChildren();

    HTMLDocumentParser::parseDocumentFragment(source, *this, contextElement, parserContentPolicy, registry);
}

bool DocumentFragment::parseXML(const String& source, Element* contextElement, OptionSet<ParserContentPolicy> parserContentPolicy)
{
    return XMLDocumentParser::parseDocumentFragment(source, *this, contextElement, parserContentPolicy);
}

RefPtr<Element> DocumentFragment::getElementById(const AtomString& id) const
{
    if (id.isEmpty())
        return nullptr;

    // Fast path for ShadowRoot, where we are both a DocumentFragment and a TreeScope.
    if (isTreeScope())
        return protect(treeScope())->getElementById(id);

    // Otherwise, fall back to iterating all of the element descendants.
    // FIXME: Remove suppression once rdar://189998365 is fixed.
    SUPPRESS_MEMORY_UNSAFE_CAST for (auto& element : descendantsOfType<Element>(*const_cast<DocumentFragment*>(this))) {
        if (element.getIdAttribute() == id)
            return &element;
    }

    return nullptr;
}

}
