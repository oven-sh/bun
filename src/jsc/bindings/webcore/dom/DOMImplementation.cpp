/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004, 2005, 2006, 2007, 2008 Apple Inc. All rights reserved.
 * Copyright (C) 2006 Samuel Weinig (sam@webkit.org)
 * Copyright (C) 2008, 2009 Torch Mobile Inc. All rights reserved. (http://www.torchmobile.com/)
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
#include "DOMImplementation.h"

#include "DocumentType.h"
#include "Element.h"
#include "HTMLBodyElement.h"
#include "HTMLDocument.h"
#include "HTMLHeadElement.h"
#include "HTMLHtmlElement.h"
#include "HTMLTitleElement.h"
#include "NameValidation.h"
#include "ParserContentPolicy.h"
#include "SVGNames.h"
#include "ScriptWrappableInlines.h"
#include "Text.h"
#include "XMLDocument.h"
#include <wtf/StdLibExtras.h>
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

using namespace HTMLNames;

WTF_MAKE_TZONE_ALLOCATED_IMPL(DOMImplementation);

DOMImplementation::DOMImplementation(Document& document)
    : m_document(document)
{
}

ExceptionOr<Ref<DocumentType>> DOMImplementation::createDocumentType(const AtomString& qualifiedName, const String& publicId, const String& systemId)
{
    if (!NameValidation::isValidDoctypeName(qualifiedName))
        return Exception { ExceptionCode::InvalidCharacterError, makeString("Invalid doctype name: '"_s, qualifiedName, '\'') };
    return DocumentType::create(protect(document()), qualifiedName, publicId, systemId);
}

static inline Ref<XMLDocument> createXMLDocument(const String& namespaceURI, ScriptExecutionContext& context)
{
    RefPtr<XMLDocument> document;
    if (namespaceURI == SVGNames::svgNamespaceURI)
        document = XMLDocument::createSVG(context, URL());
    else if (namespaceURI == HTMLNames::xhtmlNamespaceURI)
        document = XMLDocument::createXHTML(context, URL());
    else
        document = XMLDocument::create(context, URL());
    document->setParserContentPolicy({ ParserContentPolicy::AllowScriptingContent });
    return document.releaseNonNull();
}

ExceptionOr<Ref<XMLDocument>> DOMImplementation::createDocument(const AtomString& namespaceURI, const AtomString& qualifiedName, DocumentType* documentType)
{
    Ref thisDocument = m_document.get();
    Ref document = createXMLDocument(namespaceURI, *thisDocument->scriptExecutionContext());
    document->setParserContentPolicy({ ParserContentPolicy::AllowScriptingContent });

    RefPtr<Element> documentElement;
    if (!qualifiedName.isEmpty()) {
        ASSERT(!document->window()); // If domWindow is not null, createElementNS could find CustomElementRegistry and arbitrary scripts.
        auto result = document->createElementNS(namespaceURI, qualifiedName);
        if (result.hasException())
            return result.releaseException();
        documentElement = result.releaseReturnValue();
    }

    if (documentType)
        document->appendChild(*documentType);
    if (documentElement)
        document->appendChild(*documentElement);

    return document;
}

Ref<HTMLDocument> DOMImplementation::createHTMLDocument(String&& title)
{
    Ref thisDocument = m_document.get();
    Ref document = HTMLDocument::create(*thisDocument->scriptExecutionContext(), URL());
    document->setParserContentPolicy({ ParserContentPolicy::AllowScriptingContent });

    Ref htmlElement = HTMLHtmlElement::create(document);
    Ref headElement = HTMLHeadElement::create(document);
    htmlElement->appendChild(headElement);

    if (!title.isNull()) {
        Ref titleElement = HTMLTitleElement::create(titleTag, document);
        titleElement->appendChild(document->createTextNode(WTF::move(title)));
        headElement->appendChild(titleElement);
    }

    htmlElement->appendChild(HTMLBodyElement::create(document));

    document->appendChild(DocumentType::create(document, "html"_s, emptyString(), emptyString()));
    document->appendChild(htmlElement);

    return document;
}

}
