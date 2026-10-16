/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
 * Copyright (C) 2015-2025 Apple Inc. All rights reserved.
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
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#pragma once

#include "ActiveDOMCallback.h"
#include "CustomElementFormValue.h"
#include "QualifiedName.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/Weak.h>
#include <JavaScriptCore/WeakInlines.h>
#include <wtf/Forward.h>
#include <wtf/Function.h>
#include <wtf/RefCounted.h>
#include <wtf/RobinHoodHashSet.h>
#include <wtf/text/AtomStringHash.h>

namespace JSC {
class JSObject;
class PrivateName;
}

namespace Zig {
class GlobalObject;
}

namespace WebCore {

class CustomElementRegistry;
class DOMWrapperWorld;
class Document;
class Element;
class HTMLElement;
class HTMLFormElement;

using JSDOMGlobalObject = Zig::GlobalObject;

enum class ParserConstructElementWithEmptyStack : bool { No, Yes };

class JSCustomElementInterface : public RefCounted<JSCustomElementInterface>, public ActiveDOMCallback {
public:
    static Ref<JSCustomElementInterface> create(const QualifiedName& name, JSC::JSObject* callback, JSDOMGlobalObject* globalObject)
    {
        return adoptRef(*new JSCustomElementInterface(name, callback, globalObject));
    }

    // ContextDestructionObserver.
    void ref() const final { RefCounted::ref(); }
    void deref() const final { RefCounted::deref(); }

    Ref<Element> constructElementWithFallback(Document&, CustomElementRegistry&, const AtomString&, ParserConstructElementWithEmptyStack = ParserConstructElementWithEmptyStack::No);
    Ref<Element> constructElementWithFallback(Document&, CustomElementRegistry&, const QualifiedName&);
    Ref<HTMLElement> createElement(Document&);

    void upgradeElement(Element&);

    void setConnectedCallback(JSC::JSObject*);
    bool hasConnectedCallback() const { return !!m_connectedCallback; }
    void invokeConnectedCallback(Element&);

    void setDisconnectedCallback(JSC::JSObject*);
    bool hasDisconnectedCallback() const { return !!m_disconnectedCallback; }
    void invokeDisconnectedCallback(Element&);

    void setConnectedMoveCallback(JSC::JSObject*);
    bool hasConnectedMoveCallback() const { return !!m_connectedMoveCallback; }
    void invokeConnectedMoveCallback(Element&);

    void setAdoptedCallback(JSC::JSObject*);
    bool hasAdoptedCallback() const { return !!m_adoptedCallback; }
    void invokeAdoptedCallback(Element&, Document& oldDocument, Document& newDocument);

    void setAttributeChangedCallback(JSC::JSObject* callback, Vector<AtomString>&& observedAttributes);
    bool observesAttribute(const AtomString& name) const { return m_observedAttributes.contains(name); }
    void invokeAttributeChangedCallback(Element&, const QualifiedName&, const AtomString& oldValue, const AtomString& newValue);

    void disableElementInternals() { m_isElementInternalsDisabled = true; }
    bool isElementInternalsDisabled() const { return m_isElementInternalsDisabled; }

    void disableShadow() { m_isShadowDisabled = true; }
    bool isShadowDisabled() const { return m_isShadowDisabled; }

    void setIsFormAssociated() { m_isFormAssociated = true; }
    bool isFormAssociated() const { return m_isFormAssociated; }

    void setFormAssociatedCallback(JSC::JSObject*);
    bool hasFormAssociatedCallback() const { return !!m_formAssociatedCallback; }
    void invokeFormAssociatedCallback(Element&, HTMLFormElement*);

    void setFormResetCallback(JSC::JSObject*);
    bool hasFormResetCallback() const { return !!m_formResetCallback; }
    void invokeFormResetCallback(Element&);

    void setFormDisabledCallback(JSC::JSObject*);
    bool hasFormDisabledCallback() const { return !!m_formDisabledCallback; }
    void invokeFormDisabledCallback(Element&, bool isDisabled);

    void setFormStateRestoreCallback(JSC::JSObject*);
    bool hasFormStateRestoreCallback() const { return !!m_formStateRestoreCallback; }
    void invokeFormStateRestoreCallback(Element&, CustomElementFormValue state);

    ScriptExecutionContext* LEGACY_NODELETE scriptExecutionContext() const;
    JSC::JSObject* constructor() { return m_constructor.get(); }

    const QualifiedName& name() const LIFETIME_BOUND { return m_name; }

    bool isUpgradingElement() const { return !m_constructionStack.isEmpty(); }
    Element* lastElementInConstructionStack() const { return m_constructionStack.last().get(); }
    void didUpgradeLastElementInConstructionStack();

    virtual ~JSCustomElementInterface();

    template<typename Visitor> void visitJSFunctionsInGCThread(Visitor&) const;
private:
    JSCustomElementInterface(const QualifiedName&, JSC::JSObject* callback, JSDOMGlobalObject*);

    RefPtr<Element> tryToConstructCustomElement(Document&, CustomElementRegistry&, const AtomString&, ParserConstructElementWithEmptyStack);

    template<typename Function>
    void invokeCallback(Element&, JSC::JSObject* callback, NOESCAPE const Function& addArguments);

    QualifiedName m_name;
    JSC::Weak<JSC::JSObject> m_constructor;
    JSC::Weak<JSC::JSObject> m_connectedCallback;
    JSC::Weak<JSC::JSObject> m_disconnectedCallback;
    JSC::Weak<JSC::JSObject> m_connectedMoveCallback;
    JSC::Weak<JSC::JSObject> m_adoptedCallback;
    JSC::Weak<JSC::JSObject> m_attributeChangedCallback;
    JSC::Weak<JSC::JSObject> m_formAssociatedCallback;
    JSC::Weak<JSC::JSObject> m_formResetCallback;
    JSC::Weak<JSC::JSObject> m_formDisabledCallback;
    JSC::Weak<JSC::JSObject> m_formStateRestoreCallback;
    const Ref<DOMWrapperWorld> m_isolatedWorld;
    Vector<RefPtr<Element>, 1> m_constructionStack;
    MemoryCompactRobinHoodHashSet<AtomString> m_observedAttributes;
    bool m_isElementInternalsDisabled : 1;
    bool m_isShadowDisabled : 1;
    bool m_isFormAssociated : 1;
};

} // namespace WebCore
