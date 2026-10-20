/*
 * Copyright (C) 1999 Lars Knoll (knoll@kde.org)
 *           (C) 1999 Antti Koivisto (koivisto@kde.org)
 *           (C) 2000 Simon Hausmann (hausmann@kde.org)
 *           (C) 2001 Dirk Mueller (mueller@kde.org)
 * Copyright (C) 2004-2026 Apple Inc. All rights reserved.
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
#include "HTMLFrameElementBase.h"

#include "ContainerNodeInlines.h"
#include "Document.h"
#include "DocumentParser.h"
#include "ElementInlines.h"
#include "EventTargetInlines.h"
#include "HTMLNames.h"
#include "TaskSource.h"
#include "Window.h"
#include <wtf/SetForScope.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/URL.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HTMLFrameElementBase);

using namespace HTMLNames;

HTMLFrameElementBase::HTMLFrameElementBase(const QualifiedName& tagName, Document& document)
    : HTMLElement(tagName, document)
{
}

HTMLFrameElementBase::~HTMLFrameElementBase()
{
    disconnectContentFrame();
}

Document* HTMLFrameElementBase::contentDocument() const
{
    return m_contentWindow ? m_contentWindow->document() : nullptr;
}

void HTMLFrameElementBase::disconnectContentFrame()
{
    if (RefPtr window = std::exchange(m_contentWindow, nullptr))
        window->disconnectFrameElement(*this);
}

// Nothing is loaded, so every call makes a new window, as in jsdom. Only `about:blank`, `srcdoc` and `javascript:` give it a finished document.
void HTMLFrameElementBase::openURL()
{
    if (m_frameURL.isEmpty())
        m_frameURL = AtomString { aboutBlankURL().string() };

    disconnectContentFrame();

    Ref document = this->document();
    RefPtr parentWindow = document->window();
    if (!parentWindow || parentWindow->closed())
        return;

    auto completeURL = document->encodingParseURL(m_frameURL);
    if (!completeURL.isValid())
        completeURL = aboutBlankURL();
    // The script of a `javascript:` URL is not run. The document has its parent's URL, as in jsdom.
    bool isBlank = completeURL.isAboutBlank() || completeURL.protocolIsJavaScript();
    if (completeURL.protocolIsJavaScript())
        completeURL = document->url();
    auto& srcdoc = attributeWithoutSynchronization(srcdocAttr);
    bool isSrcdoc = !isBlank && completeURL.isAboutSrcDoc() && !srcdoc.isNull();

    Ref window = Window::createForFrame(*this, completeURL);
    m_contentWindow = window.copyRef();
    Ref contentDocument = *window->document();
    if (!isBlank && !isSrcdoc) {
        contentDocument->setReadyState(Document::ReadyState::Loading);
        return;
    }

    contentDocument->open();
    String markup = isSrcdoc ? srcdoc.string() : String { "<html><head></head><body></body></html>"_s };
    protect(contentDocument->parser())->appendSynchronously(markup.impl());

    // When `load` comes is jsdom's rule. A frame element without any listener is told while it is being inserted, as in browsers,
    // and its window once more afterwards. Any other is told afterwards: until then its document is still loading.
    if (m_openingURLAfterInserting && !hasEventListeners())
        contentDocument->close();
    if (!window->closed())
        parentWindow->finishLoadingFrameSoon(window);
}

void HTMLFrameElementBase::attributeChanged(const QualifiedName& name, const AtomString& oldValue, const AtomString& newValue, AttributeModificationReason attributeModificationReason)
{
    // FIXME: trimming whitespace is probably redundant with the URL parser
    if (name == srcdocAttr) {
        if (newValue.isNull())
            setLocation(attributeWithoutSynchronization(srcAttr).string().trim(isASCIIWhitespace));
        else
            setLocation(aboutSrcDocURL().string());
    } else if (name == srcAttr && !hasAttributeWithoutSynchronization(srcdocAttr))
        setLocation(newValue.string().trim(isASCIIWhitespace));
    else
        HTMLElement::attributeChanged(name, oldValue, newValue, attributeModificationReason);
}

Node::NeedsPostConnectionSteps HTMLFrameElementBase::insertionSteps(InsertionType insertionType, ContainerNode& parentOfInsertedTree)
{
    HTMLElement::insertionSteps(insertionType, parentOfInsertedTree);
    if (insertionType.connectedToDocument)
        return NeedsPostConnectionSteps::Yes;
    return NeedsPostConnectionSteps::No;
}

void HTMLFrameElementBase::postConnectionSteps()
{
    if (!isConnected())
        return;

    // DocumentFragments don't kick off any loads.
    Ref document = this->document();
    if (!document->window())
        return;

    auto work = [weakThis = WeakPtr { *this }] {
        RefPtr protectedThis = weakThis.get();
        if (!protectedThis)
            return;
        SetForScope openingURLAfterInserting(protectedThis->m_openingURLAfterInserting, true);
        if (protectedThis->isConnected())
            protectedThis->openURL();
    };
    if (!m_openingURLAfterInserting)
        work();
    else
        document->queueTask(TaskSource::DOMManipulation, WTF::move(work));
}

// Upstream disconnects the frames of a subtree before it removes it, because `unload` listeners run then. Nothing fires `unload` here.
void HTMLFrameElementBase::removingSteps(RemovalType removalType, ContainerNode& oldParentOfRemovedTree)
{
    HTMLElement::removingSteps(removalType, oldParentOfRemovedTree);
    if (removalType.disconnectedFromDocument)
        disconnectContentFrame();
}

void HTMLFrameElementBase::setLocation(const String& str)
{
    m_frameURL = AtomString(str);

    if (isConnected())
        openURL();
}

bool HTMLFrameElementBase::supportsFocus() const
{
    return true;
}

bool HTMLFrameElementBase::isURLAttribute(const Attribute& attribute) const
{
    return attribute.name() == srcAttr || attribute.name() == longdescAttr || HTMLElement::isURLAttribute(attribute);
}

bool HTMLFrameElementBase::isHTMLContentAttribute(const Attribute& attribute) const
{
    return attribute.name() == srcdocAttr || HTMLElement::isHTMLContentAttribute(attribute);
}

} // namespace WebCore
