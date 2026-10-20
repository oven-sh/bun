/*
 * Copyright (C) 2011 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 * 1. Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY GOOGLE INC. AND ITS CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL GOOGLE INC.
 * OR ITS CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "XMLErrors.h"

#include "Document.h"
#include "HTMLBodyElement.h"
#include "HTMLDivElement.h"
#include "HTMLHeadElement.h"
#include "HTMLHeadingElement.h"
#include "HTMLHtmlElement.h"
#include "HTMLNames.h"
#include "HTMLStyleElement.h"
#include "SVGNames.h"
#include "Text.h"
#include <wtf/TZoneMallocInlines.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(XMLErrors);

using namespace HTMLNames;

const int maxErrors = 25;

XMLErrors::XMLErrors(Document& document)
    : m_document(document)
{
}

void XMLErrors::handleError(Type type, StringView message, TextPosition position)
{
    if (type == Type::Fatal || (m_errorCount < maxErrors && (!m_lastErrorPosition || (m_lastErrorPosition->m_line != position.m_line && m_lastErrorPosition->m_column != position.m_column)))) {
        switch (type) {
        case Type::Warning:
            appendErrorMessage("warning"_s, position, message);
            break;
        case Type::Fatal:
        case Type::NonFatal:
            appendErrorMessage("error"_s, position, message);
        }

        m_lastErrorPosition = position;
        ++m_errorCount;
    }
}

void XMLErrors::appendErrorMessage(ASCIILiteral typeString, TextPosition position, StringView message)
{
    // <typeString> on line <lineNumber> at column <columnNumber>: <message>
    m_errorMessages.append(typeString, " on line "_s, position.m_line.oneBasedInt(), " at column "_s, position.m_column.oneBasedInt(), ": "_s, message);
}

static inline Ref<Element> createXHTMLParserErrorHeader(Document& document, String&& errorMessages)
{
    Ref reportElement = document.createElement(QualifiedName(nullAtom(), "parsererror"_s, xhtmlNamespaceURI), true);

    Attribute reportAttribute(styleAttr, "display: block; white-space: pre; border: 2px solid #c77; padding: 0 1em 0 1em; margin: 1em; background-color: #fdd; color: black"_s);
    reportElement->parserSetAttributes(singleElementSpan(reportAttribute));

    Ref h3 = HTMLHeadingElement::create(h3Tag, document);
    reportElement->parserAppendChild(h3);
    h3->parserAppendChild(Text::create(document, "This page contains the following errors:"_s));

    Ref fixed = HTMLDivElement::create(document);
    Attribute fixedAttribute(styleAttr, "font-family:monospace;font-size:12px"_s);
    fixed->parserSetAttributes(singleElementSpan(fixedAttribute));
    reportElement->parserAppendChild(fixed);

    fixed->parserAppendChild(Text::create(document, WTF::move(errorMessages)));

    h3 = HTMLHeadingElement::create(h3Tag, document);
    reportElement->parserAppendChild(h3);
    h3->parserAppendChild(Text::create(document, "Below is a rendering of the page up to the first error."_s));

    return reportElement;
}

void XMLErrors::insertErrorMessageBlock()
{
    // One or more errors occurred during parsing of the code. Display an error block to the user above
    // the normal content (the DOM tree is created manually and includes line/col info regarding
    // where the errors are located)

    // Create elements for display
    Ref document = m_document.get();
    RefPtr documentElement = document->documentElement();
    if (!documentElement) {
        Ref rootElement = HTMLHtmlElement::create(document);
        Ref body = HTMLBodyElement::create(document);
        rootElement->parserAppendChild(body);
        document->parserAppendChild(WTF::move(rootElement));
        documentElement = WTF::move(body);
    } else if (documentElement->namespaceURI() == SVGNames::svgNamespaceURI) {
        Ref rootElement = HTMLHtmlElement::create(document);
        Ref head = HTMLHeadElement::create(document);
        Ref style = HTMLStyleElement::create(document);
        head->parserAppendChild(style);
        style->parserAppendChild(document->createTextNode("html, body { height: 100% } parsererror + svg { width: 100%; height: 100% }"_s));
        style->finishParsingChildren();
        rootElement->parserAppendChild(WTF::move(head));
        Ref body = HTMLBodyElement::create(document);
        rootElement->parserAppendChild(body);

        document->parserRemoveChild(*documentElement);
        if (!documentElement->parentNode())
            body->parserAppendChild(*documentElement);

        document->parserAppendChild(WTF::move(rootElement));

        documentElement = WTF::move(body);
    }

    Ref reportElement = createXHTMLParserErrorHeader(document, String { m_errorMessages.toString() });

    if (RefPtr firstChild = documentElement->firstChild())
        documentElement->parserInsertBefore(WTF::move(reportElement), firstChild.releaseNonNull());
    else
        documentElement->parserAppendChild(WTF::move(reportElement));
}

} // namespace WebCore
