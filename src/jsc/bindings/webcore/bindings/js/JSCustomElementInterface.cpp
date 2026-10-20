/*
 * Copyright (C) 2013 Google Inc. All rights reserved.
 * Copyright (C) 2015-2017 Apple Inc. All rights reserved.
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


#include "config.h"
#include "JSCustomElementInterface.h"

#include "ContextDestructionObserverInlines.h"
#include "CustomElementRegistry.h"
#include "DOMWrapperWorld.h"
#include "ElementRareData.h"
#include "HTMLFormElement.h"
#include "HTMLMaybeFormAssociatedCustomElement.h"
#include "HTMLUnknownElement.h"
#include "JSDOMBinding.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMFormData.h"
#include "JSDocument.h"
#include "JSElement.h"
#include "JSHTMLElement.h"
#include "JSHTMLFormElement.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSLock.h>
#include <JavaScriptCore/WeakInlines.h>

namespace WebCore {
using namespace JSC;

JSCustomElementInterface::JSCustomElementInterface(const QualifiedName& name, JSObject* constructor, JSDOMGlobalObject* globalObject)
    : ActiveDOMCallback(globalObject->scriptExecutionContext())
    , m_name(name)
    , m_constructor(constructor)
    , m_isolatedWorld(globalObject->world())
    , m_isElementInternalsDisabled(false)
    , m_isShadowDisabled(false)
    , m_isFormAssociated(false)
{
}

JSCustomElementInterface::~JSCustomElementInterface() = default;

static RefPtr<Element> constructCustomElementSynchronously(Document&, VM&, JSGlobalObject&, JSObject* constructor, const AtomString& localName, ParserConstructElementWithEmptyStack);

Ref<Element> JSCustomElementInterface::constructElementWithFallback(Document& document, CustomElementRegistry& registry, const AtomString& localName, ParserConstructElementWithEmptyStack parserConstructElementWithEmptyStack)
{
    if (auto element = tryToConstructCustomElement(document, registry, localName, parserConstructElementWithEmptyStack))
        return element.releaseNonNull();

    auto element = HTMLUnknownElement::create(QualifiedName(nullAtom(), localName, HTMLNames::xhtmlNamespaceURI), document);
    element->setIsCustomElementUpgradeCandidate();
    element->setIsFailedCustomElement();
    if (registry.isScoped())
        CustomElementRegistry::addToScopedCustomElementRegistryMap(element, registry);

    return element;
}

Ref<Element> JSCustomElementInterface::constructElementWithFallback(Document& document, CustomElementRegistry& registry, const QualifiedName& name)
{
    if (auto element = tryToConstructCustomElement(document, registry, name.localName(), ParserConstructElementWithEmptyStack::No)) {
        if (!name.prefix().isEmpty())
            element->setPrefixForCustomElementUpgrade(name.prefix());
        return element.releaseNonNull();
    }

    auto element = HTMLUnknownElement::create(name, document);
    element->setIsCustomElementUpgradeCandidate();
    element->setIsFailedCustomElement();
    if (registry.isScoped())
        CustomElementRegistry::addToScopedCustomElementRegistryMap(element, registry);

    return element;
}

Ref<HTMLElement> JSCustomElementInterface::createElement(Document& document)
{
    if (m_isFormAssociated) {
        auto element = HTMLMaybeFormAssociatedCustomElement::create(m_name, document);
        element->setInterfaceIsFormAssociated();
        return element;
    }

    return HTMLElement::create(m_name, document);
}

RefPtr<Element> JSCustomElementInterface::tryToConstructCustomElement(Document& document, CustomElementRegistry& registry, const AtomString& localName, ParserConstructElementWithEmptyStack parserConstructElementWithEmptyStack)
{
    if (!canInvokeCallback())
        return nullptr;

    Ref<JSCustomElementInterface> protectedThis(*this);

    VM& vm = m_isolatedWorld->vm();
    JSLockHolder lock(vm);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    if (!m_constructor)
        return nullptr;

    Ref contextDocument = registry.document() ? *registry.document() : document;
    auto* lexicalGlobalObject = protect(scriptExecutionContext())->globalObject();
    ASSERT(lexicalGlobalObject);
    if (!lexicalGlobalObject)
        return nullptr;
    auto* constructor = m_constructor.get();
    RefPtr previousRegistry = contextDocument->activeCustomElementConstructorRegistry(constructor);
    contextDocument->addToActiveCustomElementConstructorMap(constructor, registry);
    RefPtr element = constructCustomElementSynchronously(document, vm, *lexicalGlobalObject, constructor, localName, parserConstructElementWithEmptyStack);
    if (previousRegistry)
        contextDocument->addToActiveCustomElementConstructorMap(constructor, *previousRegistry);
    else
        contextDocument->removeFromActiveCustomElementConstructorMap(constructor);
    EXCEPTION_ASSERT(!!scope.exception() == !element);
    if (!element) {
        auto* exception = scope.exception();
        scope.clearException();
        reportException(m_constructor->realm(), exception);
        return nullptr;
    }

    return element;
}

// https://dom.spec.whatwg.org/#concept-create-element
// 6. 1. If the synchronous custom elements flag is set
static RefPtr<Element> constructCustomElementSynchronously(Document& document, VM& vm, JSGlobalObject& lexicalGlobalObject, JSObject* constructor, const AtomString& localName, ParserConstructElementWithEmptyStack parserConstructElementWithEmptyStack)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto constructData = JSC::getConstructData(constructor);
    if (constructData.type == CallData::Type::None) {
        ASSERT_NOT_REACHED();
        return nullptr;
    }

    MarkedArgumentBuffer args;
    ASSERT(!args.hasOverflowed());
    JSValue newElement = construct(&lexicalGlobalObject, constructor, constructData, args);
    RETURN_IF_EXCEPTION(scope, nullptr);

    if (parserConstructElementWithEmptyStack == ParserConstructElementWithEmptyStack::Yes)
        document.performMicrotaskCheckpoint();

    ASSERT(!newElement.isEmpty());
    RefPtr wrappedElement = JSHTMLElement::toWrapped(vm, newElement);
    if (!wrappedElement) {
        throwTypeError(&lexicalGlobalObject, scope, "The result of constructing a custom element must be a HTMLElement"_s);
        return nullptr;
    }

    if (wrappedElement->hasAttributes()) {
        throwNotSupportedError(lexicalGlobalObject, scope, "A newly constructed custom element must not have attributes"_s);
        return nullptr;
    }
    if (wrappedElement->hasChildNodes()) {
        throwNotSupportedError(lexicalGlobalObject, scope, "A newly constructed custom element must not have child nodes"_s);
        return nullptr;
    }
    if (wrappedElement->parentNode()) {
        throwNotSupportedError(lexicalGlobalObject, scope, "A newly constructed custom element must not have a parent node"_s);
        return nullptr;
    }
    if (&wrappedElement->document() != &document) {
        throwNotSupportedError(lexicalGlobalObject, scope, "A newly constructed custom element belongs to a wrong document"_s);
        return nullptr;
    }
    ASSERT(wrappedElement->namespaceURI() == HTMLNames::xhtmlNamespaceURI);
    if (wrappedElement->localName() != localName) {
        throwNotSupportedError(lexicalGlobalObject, scope, "A newly constructed custom element has incorrect local name"_s);
        return nullptr;
    }

    return wrappedElement;
}

// https://html.spec.whatwg.org/multipage/custom-elements.html#concept-upgrade-an-element
void JSCustomElementInterface::upgradeElement(Element& element)
{
    ASSERT(element.tagQName().matches(name()));

    if (!element.isCustomElementUpgradeCandidate() && !element.isUncustomizedCustomElement())
        return;

    // FIXME: This assertion always seem to pass, even though the check above is more allowable.
    // It would be great to figure out why: a spec bug, lack of test coverage, or the fact we don't support customized built-ins.
    ASSERT(element.isCustomElementUpgradeCandidate());

    if (!canInvokeCallback())
        return;

    Ref<JSCustomElementInterface> protectedThis(*this);
    VM& vm = m_isolatedWorld->vm();
    JSLockHolder lock(vm);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    if (!m_constructor)
        return;

    RefPtr context = scriptExecutionContext();
    if (!context)
        return;
    JSGlobalObject* lexicalGlobalObject = context->globalObject();
    if (!lexicalGlobalObject)
        return;

    RefPtr registry = CustomElementRegistry::registryForElement(element);
    ASSERT(registry);
    Ref document = registry->document() ? *registry->document() : element.document();
    auto constructData = JSC::getConstructData(m_constructor.get());
    if (constructData.type == CallData::Type::None) {
        ASSERT_NOT_REACHED();
        return;
    }

    CustomElementReactionQueue::enqueuePostUpgradeReactions(element);

    // Unlike spec, set element's custom element state to "failed" / "precustomized" after enqueueing post-upgrade reactions
    // to avoid hitting debug assertions in enqueuePostUpgradeReactions.
    element.setIsFailedOrPrecustomizedCustomElementWithoutClearingReactionQueue();

    m_constructionStack.append(&element);

    if (m_isShadowDisabled && element.shadowRoot()) {
        element.clearReactionQueueFromFailedCustomElement();
        reportException(lexicalGlobalObject, createDOMException(lexicalGlobalObject, ExceptionCode::NotSupportedError, "Failed to upgrade an element with shadow root: the custom element definition disallows shadow roots."_s));
        return;
    }

    if (m_isFormAssociated)
        downcast<HTMLMaybeFormAssociatedCustomElement>(element).willUpgradeFormAssociated();

    auto* constructor = m_constructor.get();
    RefPtr previousRegistry = document->activeCustomElementConstructorRegistry(constructor);
    document->addToActiveCustomElementConstructorMap(constructor, *registry);

    MarkedArgumentBuffer args;
    ASSERT(!args.hasOverflowed());
    JSValue returnedElement = construct(lexicalGlobalObject, constructor, constructData, args);

    if (previousRegistry)
        document->addToActiveCustomElementConstructorMap(constructor, *previousRegistry);
    else
        document->removeFromActiveCustomElementConstructorMap(constructor);

    m_constructionStack.removeLast();

    if (scope.exception()) [[unlikely]] {
        element.clearReactionQueueFromFailedCustomElement();
        reportException(lexicalGlobalObject, scope.exception());
        return;
    }

    CheckedPtr wrappedElement = JSElement::toWrapped(vm, returnedElement);
    if (!wrappedElement || wrappedElement != &element) {
        element.clearReactionQueueFromFailedCustomElement();
        reportException(lexicalGlobalObject, createDOMException(lexicalGlobalObject, ExceptionCode::TypeError, "Custom element constructor returned a wrong element"_s));
        return;
    }

    element.setIsDefinedCustomElement(*this);

    if (m_isFormAssociated) {
        CustomElementReactionStack customElementReactionStack(lexicalGlobalObject);
        downcast<HTMLMaybeFormAssociatedCustomElement>(element).didUpgradeFormAssociated();
    }
}

void JSCustomElementInterface::invokeCallback(Element& element, JSObject* callback, NOESCAPE const auto& addArguments)
{
    if (!canInvokeCallback())
        return;

    RefPtr context = scriptExecutionContext();
    if (!context)
        return;

    Ref<JSCustomElementInterface> protectedThis(*this);
    VM& vm = m_isolatedWorld->vm();
    JSLockHolder lock(vm);

    auto* globalObject = uncheckedDowncast<JSDOMGlobalObject>(context->globalObject());
    if (!globalObject)
        return;
    JSGlobalObject* lexicalGlobalObject = globalObject;

    JSObject* jsElement = asObject(toJS(lexicalGlobalObject, globalObject, element));

    auto callData = JSC::getCallData(callback);
    ASSERT(callData.type != CallData::Type::None);

    MarkedArgumentBuffer args;
    addArguments(lexicalGlobalObject, globalObject, args);
    RELEASE_ASSERT(!args.hasOverflowed());

    NakedPtr<JSC::Exception> exception;
    JSC::call(lexicalGlobalObject, callback, callData, jsElement, args, exception);

    if (exception)
        reportException(callback->realm(), exception);
}

void JSCustomElementInterface::setConnectedCallback(JSC::JSObject* callback)
{
    m_connectedCallback = callback;
}

void JSCustomElementInterface::invokeConnectedCallback(Element& element)
{
    invokeCallback(element, m_connectedCallback.get(), [](JSC::JSGlobalObject*, JSDOMGlobalObject*, JSC::MarkedArgumentBuffer&) { });
}

void JSCustomElementInterface::setDisconnectedCallback(JSC::JSObject* callback)
{
    m_disconnectedCallback = callback;
}

void JSCustomElementInterface::invokeDisconnectedCallback(Element& element)
{
    invokeCallback(element, m_disconnectedCallback.get(), [](JSC::JSGlobalObject*, JSDOMGlobalObject*, JSC::MarkedArgumentBuffer&) { });
}

void JSCustomElementInterface::setConnectedMoveCallback(JSC::JSObject* callback)
{
    m_connectedMoveCallback = callback;
}

void JSCustomElementInterface::invokeConnectedMoveCallback(Element& element)
{
    invokeCallback(element, m_connectedMoveCallback.get(), [](JSC::JSGlobalObject*, JSDOMGlobalObject*, JSC::MarkedArgumentBuffer&) { });
}

void JSCustomElementInterface::setAdoptedCallback(JSC::JSObject* callback)
{
    m_adoptedCallback = callback;
}

void JSCustomElementInterface::invokeAdoptedCallback(Element& element, Document& oldDocument, Document& newDocument)
{
    invokeCallback(element, m_adoptedCallback.get(), [&](JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, MarkedArgumentBuffer& args) {
        args.append(toJS(lexicalGlobalObject, globalObject, oldDocument));
        args.append(toJS(lexicalGlobalObject, globalObject, newDocument));
    });
}

void JSCustomElementInterface::setAttributeChangedCallback(JSC::JSObject* callback, Vector<AtomString>&& observedAttributes)
{
    m_attributeChangedCallback = callback;
    m_observedAttributes.clear();
    for (auto&& name : WTF::move(observedAttributes))
        m_observedAttributes.add(WTF::move(name));
}

void JSCustomElementInterface::invokeAttributeChangedCallback(Element& element, const QualifiedName& attributeName, const AtomString& oldValue, const AtomString& newValue)
{
    invokeCallback(element, m_attributeChangedCallback.get(), [&](JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject*, MarkedArgumentBuffer& args) {
        args.append(toJS<IDLDOMString>(*lexicalGlobalObject, attributeName.localName()));
        args.append(toJS<IDLNullable<IDLDOMString>>(*lexicalGlobalObject, oldValue));
        args.append(toJS<IDLNullable<IDLDOMString>>(*lexicalGlobalObject, newValue));
        args.append(toJS<IDLNullable<IDLDOMString>>(*lexicalGlobalObject, attributeName.namespaceURI()));
    });
}

void JSCustomElementInterface::invokeFormAssociatedCallback(Element& element, HTMLFormElement* associatedForm)
{
    invokeCallback(element, m_formAssociatedCallback.get(), [&](JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, MarkedArgumentBuffer& args) {
        args.append(associatedForm ? toJS(lexicalGlobalObject, globalObject, *associatedForm) : jsNull());
    });
}

void JSCustomElementInterface::invokeFormResetCallback(Element& element)
{
    invokeCallback(element, m_formResetCallback.get(), [](JSC::JSGlobalObject*, JSDOMGlobalObject*, JSC::MarkedArgumentBuffer&) { });
}

void JSCustomElementInterface::invokeFormDisabledCallback(Element& element, bool isDisabled)
{
    invokeCallback(element, m_formDisabledCallback.get(), [&](JSGlobalObject*, JSDOMGlobalObject*, MarkedArgumentBuffer& args) {
        args.append(jsBoolean(isDisabled));
    });
}

void JSCustomElementInterface::invokeFormStateRestoreCallback(Element& element, CustomElementFormValue restoredState)
{
    invokeCallback(element, m_formStateRestoreCallback.get(), [&](JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, MarkedArgumentBuffer& args) {
        auto& vm = lexicalGlobalObject->vm();

        WTF::switchOn(WTF::move(restoredState),
            [&](Ref<DOMFormData>&& state) {
                args.append(toJS(lexicalGlobalObject, globalObject, WTF::move(state)));
            },
            [&](String&& state) {
                args.append(jsString(vm, WTF::move(state)));
            },
            [&](Ref<Blob>&&) {
                ASSERT_NOT_REACHED();
            },
            [](std::nullptr_t) {
                ASSERT_NOT_REACHED();
            }
        );

        args.append(jsNontrivialString(vm, "restore"_s));
    });
}

void JSCustomElementInterface::setFormAssociatedCallback(JSObject* callback)
{
    m_formAssociatedCallback = callback;
}

void JSCustomElementInterface::setFormResetCallback(JSObject* callback)
{
    m_formResetCallback = callback;
}

void JSCustomElementInterface::setFormDisabledCallback(JSObject* callback)
{
    m_formDisabledCallback = callback;
}

void JSCustomElementInterface::setFormStateRestoreCallback(JSObject* callback)
{
    m_formStateRestoreCallback = callback;
}

void JSCustomElementInterface::didUpgradeLastElementInConstructionStack()
{
    m_constructionStack.last() = nullptr;
}

ScriptExecutionContext* JSCustomElementInterface::scriptExecutionContext() const
{
    return ContextDestructionObserver::scriptExecutionContext();
}

template<typename Visitor>
void JSCustomElementInterface::visitJSFunctionsInGCThread(Visitor& visitor) const
{
    visitor.append(m_constructor);
    visitor.append(m_connectedCallback);
    visitor.append(m_disconnectedCallback);
    visitor.append(m_connectedMoveCallback);
    visitor.append(m_adoptedCallback);
    visitor.append(m_attributeChangedCallback);
    visitor.append(m_formAssociatedCallback);
    visitor.append(m_formResetCallback);
    visitor.append(m_formDisabledCallback);
    visitor.append(m_formStateRestoreCallback);
}

template void JSCustomElementInterface::visitJSFunctionsInGCThread(JSC::AbstractSlotVisitor&) const;
template void JSCustomElementInterface::visitJSFunctionsInGCThread(JSC::SlotVisitor&) const;

} // namespace WebCore
