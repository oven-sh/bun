/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2003-2025 Apple Inc. All rights reserved.
 * Copyright (C) 2008 Nikolas Zimmermann <zimmermann@kde.org>
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
#include "ScriptElement.h"

#include "Document.h"
#include "ElementInlines.h"
#include "HTMLScriptElement.h"
#include "NodeName.h"
#include "TextNodeTraversal.h"
#include <wtf/SortedArrayMap.h>
#include <wtf/text/MakeString.h>

namespace WebCore {

ScriptElement::ScriptElement(Element& element, bool parserInserted, bool alreadyStarted)
    : m_element(element)
    , m_parserInserted(parserInserted ? ParserInserted::Yes : ParserInserted::No)
    , m_alreadyStarted(alreadyStarted)
    , m_forceAsync(!parserInserted)
{
}

void ScriptElement::postConnectionSteps()
{
    if (m_parserInserted == ParserInserted::No)
        prepareScript();
}

void ScriptElement::childrenChanged(const ContainerNode::ChildChange& childChange)
{
    if (m_parserInserted == ParserInserted::No && childChange.isInsertion() && element().isConnected())
        prepareScript();
}

void ScriptElement::handleSourceAttribute(const String& sourceURL)
{
    if (ignoresLoadRequest() || sourceURL.isNull())
        return;

    prepareScript();
}

void ScriptElement::handleAsyncAttribute()
{
    m_forceAsync = false;
}

// https://html.spec.whatwg.org/multipage/scripting.html#javascript-mime-type
constexpr SortedArraySet supportedJavaScriptMIMETypes { WTF::toArray<ComparableLettersLiteral>({
    "application/ecmascript"_s,
    "application/javascript"_s,
    "application/x-ecmascript"_s,
    "application/x-javascript"_s,
    "text/ecmascript"_s,
    "text/javascript"_s,
    "text/javascript1.0"_s,
    "text/javascript1.1"_s,
    "text/javascript1.2"_s,
    "text/javascript1.3"_s,
    "text/javascript1.4"_s,
    "text/javascript1.5"_s,
    "text/jscript"_s,
    "text/livescript"_s,
    "text/x-ecmascript"_s,
    "text/x-javascript"_s,
}) };

// https://html.spec.whatwg.org/C#prepare-the-script-element (Steps 8-12)
std::optional<ScriptType> ScriptElement::determineScriptType(const String& type, const String& language, bool isHTMLDocument)
{
    // Step 8. If any of the following are true:
    //  - el has a type attribute whose value is the empty string;
    //  - el has no type attribute but it has a language attribute and that attribute's value is the empty string; or
    //  - el has neither a type attribute nor a language attribute,
    // then let the script block's type string for this script element be "text/javascript".
    if (type.isNull()) {
        if (language.isEmpty())
            return ScriptType::Classic;
        if (supportedJavaScriptMIMETypes.contains(makeString("text/"_s, language)))
            return ScriptType::Classic;
        return std::nullopt;
    }
    if (type.isEmpty())
        return ScriptType::Classic; // Assume text/javascript.

    // Step 9. If the script block's type string is a JavaScript MIME type essence match, then set el's type to "classic".
    if (supportedJavaScriptMIMETypes.contains(StringView(type).trim(isASCIIWhitespace)))
        return ScriptType::Classic;

    // FIXME: XHTML spec defines "defer" attribute. But WebKit does not implement it for a long time.
    // And module tag also uses defer attribute semantics. We disable script type="module" for non HTML document.
    // Once "defer" is implemented, we can reconsider enabling modules in XHTML.
    // https://bugs.webkit.org/show_bug.cgi?id=123387
    if (!isHTMLDocument)
        return std::nullopt;

    // Step 10. Otherwise, if the script block's type string is an ASCII case-insensitive match for the string "module", then set el's type to "module".
    if (equalLettersIgnoringASCIICase(type, "module"_s))
        return ScriptType::Module;

    // Step 11. Otherwise, if the script block's type string is an ASCII case-insensitive match for the string "importmap", then set el's type to "importmap".
    if (equalLettersIgnoringASCIICase(type, "importmap"_s))
        return ScriptType::ImportMap;

    return std::nullopt;
}

std::optional<ScriptType> ScriptElement::determineScriptType() const
{
    return determineScriptType(typeAttributeValue(), languageAttributeValue(), element().document().isHTMLDocument());
}

// https://html.spec.whatwg.org/multipage/scripting.html#prepare-the-script-element
bool ScriptElement::prepareScript(const TextPosition&)
{
    if (m_alreadyStarted)
        return false;

    bool wasParserInserted;
    if (m_parserInserted == ParserInserted::Yes) {
        wasParserInserted = true;
        m_parserInserted = ParserInserted::No;
    } else
        wasParserInserted = false;

    if (wasParserInserted && !hasAsyncAttribute())
        m_forceAsync = true;

    if (!hasSourceAttribute() && scriptContent().isEmpty())
        return false;

    if (!element().isConnected())
        return false;

    if (!determineScriptType())
        return false;

    if (wasParserInserted) {
        m_parserInserted = ParserInserted::Yes;
        m_forceAsync = false;
    }

    m_alreadyStarted = true;

    return false;
}

bool ScriptElement::ignoresLoadRequest() const
{
    return m_alreadyStarted || m_parserInserted == ParserInserted::Yes || !element().isConnected();
}

String ScriptElement::scriptContent() const
{
    return TextNodeTraversal::childTextContent(protect(element()));
}

bool isScriptElement(Node& node)
{
    if (is<HTMLScriptElement>(node))
        return true;
    auto* element = dynamicDowncast<Element>(node);
    return element && element->elementName() == ElementNames::SVG::script;
}

ScriptElement* dynamicDowncastScriptElement(Element& element)
{
    return dynamicDowncast<HTMLScriptElement>(element);
}

}
