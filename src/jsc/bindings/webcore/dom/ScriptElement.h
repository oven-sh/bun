/*
 * Copyright (C) 2008 Nikolas Zimmermann <zimmermann@kde.org>
 * Copyright (C) 2009-2022 Apple Inc. All rights reserved.
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

#include "Element.h"
#include "ScriptType.h"
#include <wtf/text/TextPosition.h>

namespace WebCore {

enum class ParserInserted : bool { No, Yes };
static constexpr unsigned bitWidthOfParserInserted = 1;
static_assert(static_cast<unsigned>(ParserInserted::Yes) <= ((1U << bitWidthOfParserInserted) - 1));

class ScriptElement {
public:
    virtual ~ScriptElement() = default;

    virtual void ref() const = 0;
    virtual void deref() const = 0;

    Element& element() { return m_element; }
    const Element& element() const { return m_element; }

    bool prepareScript(const TextPosition& scriptStartPosition = TextPosition());

    void markAlreadyStarted() { m_alreadyStarted = true; }

    WEBCORE_EXPORT String scriptContent() const;

    virtual bool hasAsyncAttribute() const = 0;
    virtual bool hasSourceAttribute() const = 0;

    static std::optional<ScriptType> determineScriptType(const String& typeAttribute, const String& languageAttribute, bool isHTMLDocument = true);

protected:
    ScriptElement(Element&, bool createdByParser, bool isEvaluated);

    bool alreadyStarted() const { return m_alreadyStarted; }
    bool forceAsync() const { return m_forceAsync; }

    // Helper functions used by our parent classes.
    Node::NeedsPostConnectionSteps insertionSteps(Node::InsertionType insertionType, ContainerNode&) const
    {
        if (insertionType.connectedToDocument && m_parserInserted == ParserInserted::No)
            return Node::NeedsPostConnectionSteps::Yes;
        return Node::NeedsPostConnectionSteps::No;
    }

    void postConnectionSteps();
    void childrenChanged(const ContainerNode::ChildChange&);
    void handleSourceAttribute(const String& sourceURL);
    void LEGACY_NODELETE handleAsyncAttribute();

private:
    std::optional<ScriptType> determineScriptType() const;
    bool LEGACY_NODELETE ignoresLoadRequest() const;

    virtual String typeAttributeValue() const = 0;
    virtual String languageAttributeValue() const = 0;

    WeakRef<Element, WeakPtrImplWithEventTargetData> m_element;
    ParserInserted m_parserInserted : bitWidthOfParserInserted;
    bool m_alreadyStarted : 1;
    bool m_forceAsync : 1;
};

// FIXME: replace with is/downcast<ScriptElement>.
bool LEGACY_NODELETE isScriptElement(Node&);
ScriptElement* LEGACY_NODELETE dynamicDowncastScriptElement(Element&);

}
